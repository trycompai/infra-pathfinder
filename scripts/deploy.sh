#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
CLUSTER_NAME="pathfinder"
MIGRATION_PROJECT="pathfinder-migration-build"
APP_PROJECT="pathfinder-app-build"

echo -e "${GREEN}🚀 Starting Pathfinder deployment...${NC}"

# Function to wait for CodeBuild
wait_for_build() {
    local build_id=$1
    local project_name=$2
    
    echo -e "${YELLOW}⏳ Waiting for $project_name build to complete...${NC}"
    
    while true; do
        status=$(aws codebuild batch-get-builds --ids "$build_id" --query 'builds[0].buildStatus' --output text)
        
        case $status in
            "SUCCEEDED")
                echo -e "${GREEN}✅ $project_name build completed successfully${NC}"
                return 0
                ;;
            "FAILED"|"FAULT"|"STOPPED"|"TIMED_OUT")
                echo -e "${RED}❌ $project_name build failed with status: $status${NC}"
                return 1
                ;;
            "IN_PROGRESS")
                echo "  Still building..."
                sleep 30
                ;;
            *)
                echo "  Status: $status"
                sleep 30
                ;;
        esac
    done
}

# Step 1: Update Infrastructure
echo -e "${YELLOW}📋 Step 1: Updating infrastructure...${NC}"
cd apps/infra
export NODE_ENV=production
pulumi up --yes
cd ../..
echo -e "${GREEN}✅ Infrastructure updated${NC}"

# Wait for infrastructure to stabilize
echo -e "${YELLOW}⏳ Waiting for infrastructure to stabilize...${NC}"
sleep 30

# Step 2: Smart Migration Build (content-based verification)
echo -e "${YELLOW}🔍 Step 2: Checking migration content hash and building if needed...${NC}"

migration_build_id=$(aws codebuild start-build \
    --project-name "$MIGRATION_PROJECT" \
    --environment-variables-override name=RUN_MIGRATIONS,value=true \
    --query 'build.id' --output text)

echo "Migration build ID: $migration_build_id"
wait_for_build "$migration_build_id" "Migration Build and Run"

# Step 3: Build Application (Next.js with DB access, then Docker packaging)
echo -e "${YELLOW}🔨 Step 3: Building Next.js with database access, then packaging...${NC}"
app_build_id=$(aws codebuild start-build \
    --project-name "$APP_PROJECT" \
    --query 'build.id' --output text)

echo "App build ID: $app_build_id"
wait_for_build "$app_build_id" "Application"

# Step 4: Deploy Application
echo -e "${YELLOW}🚢 Step 4: Deploying application...${NC}"

# Wait for ECR to process the new image
echo -e "${YELLOW}⏳ Waiting for ECR to process new image...${NC}"
sleep 30

# Update ECS service
aws ecs update-service \
    --cluster "$CLUSTER_NAME" \
    --service pathfinder-app \
    --force-new-deployment > /dev/null

echo -e "${YELLOW}⏳ Waiting for deployment to stabilize...${NC}"
aws ecs wait services-stable \
    --cluster "$CLUSTER_NAME" \
    --services pathfinder-app

echo -e "${GREEN}✅ Application deployed successfully${NC}"

# Step 5: Verify Deployment
echo -e "${YELLOW}🔍 Step 5: Verifying deployment...${NC}"

# Get ALB DNS name
alb_dns=$(aws elbv2 describe-load-balancers \
    --names pathfinder-lb \
    --query 'LoadBalancers[0].DNSName' --output text)

# Health check
if curl -sf "http://$alb_dns/health" > /dev/null; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo -e "${GREEN}🌐 Application URL: http://$alb_dns${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
    exit 1
fi 