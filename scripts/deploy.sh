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

# Step 2: Build and Deploy Application (includes migrations)
echo -e "${YELLOW}🔨 Step 2: Building application (migrations + Next.js + Docker)...${NC}"
app_build_id=$(aws codebuild start-build \
    --project-name "$APP_PROJECT" \
    --query 'build.id' --output text)

echo "App build ID: $app_build_id"
wait_for_build "$app_build_id" "Application"

# Step 3: Verify Deployment
echo -e "${YELLOW}🔍 Step 3: Verifying deployment...${NC}"

# Wait for ECS service to stabilize after the build updated it
echo -e "${YELLOW}⏳ Waiting for ECS deployment to stabilize...${NC}"
aws ecs wait services-stable \
    --cluster "$CLUSTER_NAME" \
    --services pathfinder-app

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