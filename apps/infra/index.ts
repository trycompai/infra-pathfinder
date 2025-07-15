import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// ==========================================
// CONFIGURATION & SHARED SETTINGS
// ==========================================

// Common tags for all resources
const commonTags = {
  Project: "pathfinder",
  Environment: pulumi.getStack(), // Will be "dev", "staging", "production" etc.
  ManagedBy: "pulumi",
  Owner: "platform-team",
  CreatedDate: new Date().toISOString().split("T")[0], // YYYY-MM-DD
};

// ==========================================
// NETWORKING LAYER
// VPC, Subnets, Security Groups
// ==========================================

// VPC with public subnets for ALB and private subnets for containers
const vpc = new awsx.ec2.Vpc("pathfinder-vpc", {
  tags: {
    ...commonTags,
    Name: "pathfinder-vpc",
  },
});

// Security Groups
// ALB: Allow HTTP from internet
const albSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-alb-sg", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: {
    ...commonTags,
    Name: "pathfinder-alb-sg",
    Type: "load-balancer",
  },
});

// Service: Only accept traffic from ALB (not directly from internet)
const serviceSecurityGroup = new aws.ec2.SecurityGroup(
  "pathfinder-service-sg",
  {
    vpcId: vpc.vpcId,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 3000, // Next.js port
        toPort: 3000,
        securityGroups: [albSecurityGroup.id],
      },
    ],
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    tags: {
      ...commonTags,
      Name: "pathfinder-service-sg",
      Type: "ecs-service",
    },
  }
);

// Database Security Group - initially allow access from ECS service only
const dbSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-db-sg", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      securityGroups: [serviceSecurityGroup.id], // Allow from ECS service
      description: "Allow access from main application service",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: {
    ...commonTags,
    Name: "pathfinder-db-sg",
    Type: "database",
  },
});

// CodeBuild Security Group - allow database access and internet for builds
const codeBuildSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-codebuild-sg", {
  vpcId: vpc.vpcId,
  ingress: [], // No inbound rules needed - CodeBuild initiates connections
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"], // Allow all outbound for package downloads and ECR push
      description: "Allow all outbound traffic for builds",
    },
  ],
  tags: {
    ...commonTags,
    Name: "pathfinder-codebuild-sg",
    Type: "build",
  },
});

// Tailscale Security Group - allow database access and internet for Tailscale connection
const tailscaleSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-tailscale-sg", {
  vpcId: vpc.vpcId,
  ingress: [], // No inbound rules needed - Tailscale initiates connections
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"], // Allow all outbound for Tailscale connectivity
      description: "Allow all outbound traffic for Tailscale",
    },
  ],
  tags: {
    ...commonTags,
    Name: "pathfinder-tailscale-sg",
    Type: "proxy",
  },
});

// Additional database security group rules for CodeBuild and Tailscale access
const dbCodeBuildRule = new aws.ec2.SecurityGroupRule("db-allow-codebuild", {
  type: "ingress",
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  sourceSecurityGroupId: codeBuildSecurityGroup.id,
  securityGroupId: dbSecurityGroup.id,
  description: "Allow CodeBuild access to database for Docker builds",
});

const dbTailscaleRule = new aws.ec2.SecurityGroupRule("db-allow-tailscale", {
  type: "ingress",
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  sourceSecurityGroupId: tailscaleSecurityGroup.id,
  securityGroupId: dbSecurityGroup.id,
  description: "Allow Tailscale proxy access to database for developer access",
});

// ==========================================
// DATABASE LAYER
// RDS PostgreSQL with auto-scaling storage
// ==========================================

// RDS Subnet Group - keep database in private subnets
const dbSubnetGroup = new aws.rds.SubnetGroup("pathfinder-db-subnet-group", {
  subnetIds: vpc.privateSubnetIds,
  tags: {
    ...commonTags,
    Name: "pathfinder-db-subnet-group",
  },
});

// Generate a secure random password for the database
const dbPassword = new random.RandomPassword("pathfinder-db-password-v2", {
  length: 32,
  special: true,
  overrideSpecial: "!#$%&*()-_=+[]{}<>:?", // RDS doesn't allow: / @ " space
});

// RDS PostgreSQL Instance
const db = new aws.rds.Instance("pathfinder-db", {
  engine: "postgres",
  engineVersion: "15.13", // Updated to latest available version
  instanceClass: "db.t3.small", // Upgraded from micro: 2 vCPU, 2 GB RAM
  allocatedStorage: 50, // 50 GB (up from 20 GB)
  maxAllocatedStorage: 1000, // Auto-scale storage up to 1 TB as needed
  storageType: "gp3",
  storageEncrypted: true, // Enable encryption at rest
  dbName: "pathfinder",
  username: "pathfinder_admin",
  password: dbPassword.result, // Use the generated secure password
  vpcSecurityGroupIds: [dbSecurityGroup.id],
  dbSubnetGroupName: dbSubnetGroup.name,
  
  // Use default parameter group (requires SSL - AWS best practice)
  applyImmediately: true, // Apply parameter changes immediately (requires restart)
  
  skipFinalSnapshot: true, // For dev - set to false in production
  deletionProtection: false, // For dev - set to true in production
  backupRetentionPeriod: 7, // Keep backups for 7 days
  backupWindow: "03:00-04:00", // 3-4 AM UTC
  maintenanceWindow: "sun:04:00-sun:05:00", // Sunday 4-5 AM UTC
  enabledCloudwatchLogsExports: ["postgresql"], // Export logs to CloudWatch
  tags: {
    ...commonTags,
    Name: "pathfinder-db",
    Engine: "postgresql",
    Tier: "database",
  },
});

// ==========================================
// MONITORING & OBSERVABILITY
// CloudWatch Alarms for proactive monitoring
// ==========================================

// Database Monitoring
const dbHighCPUAlarm = new aws.cloudwatch.MetricAlarm(
  "pathfinder-db-high-cpu",
  {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "CPUUtilization",
    namespace: "AWS/RDS",
    period: 300, // 5 minutes
    statistic: "Average",
    threshold: 80,
    alarmDescription: "Triggers when database CPU exceeds 80% for 10 minutes",
    dimensions: {
      DBInstanceIdentifier: db.id,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-db-high-cpu-alarm",
      Type: "monitoring",
    },
  }
);

const dbHighConnectionsAlarm = new aws.cloudwatch.MetricAlarm(
  "pathfinder-db-high-connections",
  {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "DatabaseConnections",
    namespace: "AWS/RDS",
    period: 300, // 5 minutes
    statistic: "Average",
    threshold: 80, // db.t3.small has max ~100 connections, so 80 is 80%
    alarmDescription: "Triggers when database connections exceed 80",
    dimensions: {
      DBInstanceIdentifier: db.id,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-db-high-connections-alarm",
      Type: "monitoring",
    },
  }
);

const dbLowStorageAlarm = new aws.cloudwatch.MetricAlarm(
  "pathfinder-db-low-storage",
  {
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 1,
    metricName: "FreeStorageSpace",
    namespace: "AWS/RDS",
    period: 300, // 5 minutes
    statistic: "Average",
    threshold: 5 * 1024 * 1024 * 1024, // 5 GB in bytes
    alarmDescription: "Triggers when free storage drops below 5 GB",
    dimensions: {
      DBInstanceIdentifier: db.id,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-db-low-storage-alarm",
      Type: "monitoring",
    },
  }
);

// ==========================================
// LOAD BALANCING & TRAFFIC MANAGEMENT
// Application Load Balancer with health checks
// ==========================================

const lb = new awsx.lb.ApplicationLoadBalancer("pathfinder-lb", {
  subnetIds: vpc.publicSubnetIds,
  securityGroups: [albSecurityGroup.id],
  tags: {
    ...commonTags,
    Name: "pathfinder-lb",
    Type: "application-load-balancer",
  },
  defaultTargetGroup: {
    port: 3000,
    protocol: "HTTP",
    targetType: "ip", // Required for Fargate
    healthCheck: {
      enabled: true,
      path: "/",
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      timeout: 30,
      interval: 60,
      matcher: "200",
    },
  },
});

// ==========================================
// CONTAINER INFRASTRUCTURE
// ECR, ECS Service, IAM Roles, Logging
// ==========================================

// ECS Cluster
const cluster = new aws.ecs.Cluster("pathfinder-cluster", {
  tags: {
    ...commonTags,
    Name: "pathfinder-cluster",
  },
});

// Logging
const logGroup = new aws.cloudwatch.LogGroup("pathfinder-logs", {
  retentionInDays: 7,
  tags: {
    ...commonTags,
    Name: "pathfinder-logs",
    Type: "application-logs",
  },
});

// ECS needs this role to pull images and write logs
const executionRole = new aws.iam.Role("pathfinder-execution-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "ecs-tasks.amazonaws.com",
        },
      },
    ],
  }),
});

new aws.iam.RolePolicyAttachment("pathfinder-execution-role-policy", {
  role: executionRole.name,
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

// CodeBuild Role for building Docker images inside VPC
const codeBuildRole = new aws.iam.Role("pathfinder-codebuild-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "codebuild.amazonaws.com",
        },
      },
    ],
  }),
  tags: {
    ...commonTags,
    Name: "pathfinder-codebuild-role",
  },
});

// CodeBuild policy for ECR, VPC, and CloudWatch access
const codeBuildPolicy = new aws.iam.Policy("pathfinder-codebuild-policy", {
  policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:GetAuthorizationToken",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        "Resource": "arn:aws:logs:*:*:*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeDhcpOptions",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcs",
          "ec2:CreateNetworkInterfacePermission"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "secretsmanager:GetSecretValue"
        ],
        "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:pathfinder-*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTasks"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Action": [
          "iam:PassRole"
        ],
        "Resource": "${executionRole.arn}"
      }
    ]
  }`,
  tags: {
    ...commonTags,
    Name: "pathfinder-codebuild-policy",
  },
});

new aws.iam.RolePolicyAttachment("pathfinder-codebuild-policy-attachment", {
  role: codeBuildRole.name,
  policyArn: codeBuildPolicy.arn,
});

// ECR for storing Docker images
const repo = new awsx.ecr.Repository("pathfinder-repo", {
  forceDelete: true, // Allow deletion even if images exist
  tags: {
    ...commonTags,
    Name: "pathfinder-repo",
    Type: "container-registry",
  },
});

// CodeBuild Project for building Docker images inside VPC
const codeBuildProject = new aws.codebuild.Project("pathfinder-codebuild", {
  serviceRole: codeBuildRole.arn,
  artifacts: {
    type: "NO_ARTIFACTS", // We push directly to ECR
  },
  environment: {
    computeType: "BUILD_GENERAL1_MEDIUM",
    image: "aws/codebuild/standard:7.0",
    type: "LINUX_CONTAINER",
    privilegedMode: true, // Required for Docker builds
    environmentVariables: [
      {
        name: "AWS_DEFAULT_REGION",
        value: "us-east-1",
      },
      {
        name: "AWS_ACCOUNT_ID",
        value: aws.getCallerIdentity().then(id => id.accountId),
      },
      {
        name: "IMAGE_REPO_NAME",
        value: repo.repository.name,
      },
      {
        name: "IMAGE_TAG",
        value: "latest",
      },
      {
        name: "DATABASE_URL",
        value: pulumi.interpolate`postgresql://${db.username}:${dbPassword.result}@${db.endpoint}/${db.dbName}`,
      },
      {
        name: "CLUSTER_NAME",
        value: cluster.name,
      },
      {
        name: "SUBNET_ID", 
        value: vpc.privateSubnetIds[0], // Use first private subnet for migration
      },
      {
        name: "SECURITY_GROUP_ID",
        value: serviceSecurityGroup.id, // Same security group as main service
      },
    ],
  },
  source: {
    type: "GITHUB",
    location: "https://github.com/trycompai/infra-pathfinder.git",
    gitCloneDepth: 1,
    buildspec: "apps/web/buildspec.yml",
  },
  vpcConfig: {
    vpcId: vpc.vpcId,
    subnets: vpc.privateSubnetIds,
    securityGroupIds: [codeBuildSecurityGroup.id],
  },
  tags: {
    ...commonTags,
    Name: "pathfinder-codebuild",
    Type: "build-service",
  },
});

// NOTE: Webhook removed - will use GitHub Actions to trigger CodeBuild instead
// This avoids GitHub token authentication issues

// Tailscale authentication key secret
const tailscaleAuthKey = new aws.secretsmanager.Secret("pathfinder-tailscale-authkey", {
  description: "Tailscale authentication key for RDS proxy service",
  tags: {
    ...commonTags,
    Name: "pathfinder-tailscale-authkey",
    Type: "secret",
  },
});

// Store the Tailscale auth key from environment variable
const tailscaleAuthKeyValue = new aws.secretsmanager.SecretVersion("pathfinder-tailscale-authkey-value", {
  secretId: tailscaleAuthKey.id,
  secretString: process.env.TAILSCALE_AUTH_KEY || "MISSING_TAILSCALE_KEY",
});

// GitHub personal access token secret for CodeBuild webhooks  
const githubToken = new aws.secretsmanager.Secret("pathfinder-github-token", {
  description: "GitHub personal access token for CodeBuild webhooks",
  tags: {
    ...commonTags,
    Name: "pathfinder-github-token", 
    Type: "secret",
  },
});

// Store the GitHub token from environment variable
const githubTokenValue = new aws.secretsmanager.SecretVersion("pathfinder-github-token-value", {
  secretId: githubToken.id,
  secretString: process.env.GITHUB_TOKEN || "MISSING_GITHUB_TOKEN",
});

// ==========================================
// TWO-PHASE BUILD: MIGRATIONS FIRST, THEN APP
// ==========================================

// Phase 1: Reference migration image (built by CodeBuild)
const migrationImageUri = pulumi.interpolate`${repo.url}:migration-latest`;

// ECS Task Definition for running migrations
const migrationTaskDef = new aws.ecs.TaskDefinition("pathfinder-migration-task", {
  family: "pathfinder-migration",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "512",
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi.jsonStringify([
    {
      name: "migration-runner",
      image: migrationImageUri,
      essential: true,
      environment: [
        {
          name: "DATABASE_URL",
          value: pulumi.interpolate`postgresql://${db.username}:${db.password}@${db.endpoint}/${db.dbName}`,
        },
      ],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": logGroup.name,
          "awslogs-region": aws.config.region!,
          "awslogs-stream-prefix": "migration-task",
          "awslogs-create-group": "true",
        },
      },
    },
  ]),
  tags: {
    ...commonTags,
    Name: "pathfinder-migration-task",
  },
});

// Trigger CodeBuild to build images and run migrations  
const buildImagesAndMigrate = new command.local.Command("build-images-and-migrate", {
  create: pulumi.interpolate`
    set -euo pipefail  # Exit on any error, undefined vars, or pipe failures
    
    echo "🚀 Starting CodeBuild to build images and run migrations..."
    
    # Start CodeBuild project
    BUILD_ID=$(aws codebuild start-build \
      --project-name ${codeBuildProject.name} \
      --region ${aws.config.region} \
      --query 'build.id' \
      --output text)
    
    if [ -z "$BUILD_ID" ] || [ "$BUILD_ID" = "None" ]; then
      echo "❌ Failed to start CodeBuild"
      exit 1
    fi
    
    echo "📋 CodeBuild started: $BUILD_ID"
    
    # Wait for build to complete (polling approach since AWS CLI doesn't have wait build-complete)
    echo "⏳ Waiting for CodeBuild to complete (this builds images and runs migrations)..."
    while true; do
      BUILD_STATUS=$(aws codebuild batch-get-builds \
        --ids $BUILD_ID \
        --region ${aws.config.region} \
        --query 'builds[0].buildStatus' \
        --output text)
      
      echo "Current build status: $BUILD_STATUS"
      
      if [ "$BUILD_STATUS" = "SUCCEEDED" ]; then
        echo "✅ CodeBuild completed successfully!"
        break
      elif [ "$BUILD_STATUS" = "FAILED" ] || [ "$BUILD_STATUS" = "FAULT" ] || [ "$BUILD_STATUS" = "STOPPED" ] || [ "$BUILD_STATUS" = "TIMED_OUT" ]; then
        echo "❌ CodeBuild failed with status: $BUILD_STATUS"
        echo "📋 Check CodeBuild logs in AWS Console"
        exit 1
      fi
      
      echo "Build still in progress... waiting 30 seconds"
      sleep 30
    done
  `,
}, {
  dependsOn: [codeBuildProject, db, cluster]
});

// Phase 2: Reference app image (built by CodeBuild with database access)
const imageUri = pulumi.interpolate`${repo.url}:latest`;

// Fargate Service (migrations already completed during deployment)
const service = new awsx.ecs.FargateService("pathfinder-service", {
  cluster: cluster.arn,
  networkConfiguration: {
    subnets: vpc.privateSubnetIds,
    securityGroups: [serviceSecurityGroup.id],
    assignPublicIp: true, // Needed to pull images from ECR
  },
  desiredCount: 2,
  taskDefinitionArgs: {
    executionRole: {
      roleArn: executionRole.arn,
    },
    containers: {
      // Main application container (migrations already completed)
      "pathfinder-app": {
        name: "pathfinder-app",
        image: imageUri,
        cpu: 1024, // 1 vCPU
        memory: 2048, // 2GB
        essential: true,
        environment: [
          {
            name: "HOSTNAME",
            value: "0.0.0.0", // Critical: bind to all interfaces, not just localhost
          },
          {
            name: "PORT",
            value: "3000",
          },
                  {
          name: "DATABASE_URL",
          value: pulumi.interpolate`postgresql://${db.username}:${db.password}@${db.endpoint}/${db.dbName}`,
        },
          {
            name: "ENABLE_DEBUG_ENDPOINTS",
            value: "true", // Temporary: for debugging environment variables
          },
        ],
        portMappings: [
          {
            containerPort: 3000,
            targetGroup: lb.defaultTargetGroup,
          },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup.name,
            "awslogs-region": aws.config.region,
            "awslogs-stream-prefix": "pathfinder-app",
          },
        },
      },
    },
  },
}, {
  dependsOn: [buildImagesAndMigrate] // Wait for CodeBuild to build images and run migrations
});

// Tailscale RDS Proxy Service
const tailscaleService = new awsx.ecs.FargateService("pathfinder-tailscale-proxy", {
  cluster: cluster.arn,
  networkConfiguration: {
    subnets: vpc.privateSubnetIds,
    securityGroups: [tailscaleSecurityGroup.id],
    assignPublicIp: true, // Needed for Tailscale connectivity
  },
  desiredCount: 1,
  taskDefinitionArgs: {
    executionRole: {
      roleArn: executionRole.arn,
    },
    containers: {
      "tailscale-proxy": {
        name: "tailscale-proxy",
        image: "tailscale/tailscale:stable",
        cpu: 256, // 0.25 vCPU - minimal resources needed
        memory: 512, // 512MB
        essential: true,
        environment: [
          {
            name: "TS_HOSTNAME",
            value: "pathfinder-rds-proxy",
          },
        ],
        secrets: [
          {
            name: "TS_AUTHKEY",
            valueFrom: tailscaleAuthKey.arn,
          },
        ],
        command: [
          "/bin/sh", 
          "-c", 
          pulumi.interpolate`mkdir -p /tmp/tailscale && /usr/local/bin/tailscaled --tun=userspace-networking --socks5-server=localhost:1055 & /usr/local/bin/tailscale up --auth-key=$TS_AUTHKEY --hostname=$TS_HOSTNAME && apk add --no-cache socat && socat TCP-LISTEN:5432,fork,reuseaddr TCP:${db.endpoint}:5432`
        ],
        portMappings: [
          {
            containerPort: 5432,
          },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup.name,
            "awslogs-region": aws.config.region,
            "awslogs-stream-prefix": "tailscale-proxy",
          },
        },
      },
    },
  },
}, {
  dependsOn: [buildImagesAndMigrate] // Wait for CodeBuild to build images before starting proxy
});

// ==========================================
// AUTO-SCALING CONFIGURATION
// Automatically scale ECS tasks based on CPU
// ==========================================

const scaling = new aws.appautoscaling.Target("pathfinder-scaling", {
  maxCapacity: 10,
  minCapacity: 2,
  resourceId: pulumi.interpolate`service/${cluster.name}/${service.service.name}`,
  scalableDimension: "ecs:service:DesiredCount",
  serviceNamespace: "ecs",
});

const scalingPolicy = new aws.appautoscaling.Policy(
  "pathfinder-scaling-policy",
  {
    policyType: "TargetTrackingScaling",
    resourceId: scaling.resourceId,
    scalableDimension: scaling.scalableDimension,
    serviceNamespace: scaling.serviceNamespace,
    targetTrackingScalingPolicyConfiguration: {
      targetValue: 50, // Scale at 50% CPU
      predefinedMetricSpecification: {
        predefinedMetricType: "ECSServiceAverageCPUUtilization",
      },
    },
  }
);

// ==========================================
// ADDITIONAL MONITORING
// ECS Service and Load Balancer health checks
// ==========================================

const ecsHighCPUAlarm = new aws.cloudwatch.MetricAlarm(
  "pathfinder-ecs-high-cpu",
  {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "CPUUtilization",
    namespace: "AWS/ECS",
    period: 300, // 5 minutes
    statistic: "Average",
    threshold: 80,
    alarmDescription:
      "Triggers when ECS service CPU exceeds 80% (may trigger auto-scaling)",
    dimensions: {
      ClusterName: cluster.name,
      ServiceName: service.service.name,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-ecs-high-cpu-alarm",
      Type: "monitoring",
    },
  }
);

const albUnhealthyHostsAlarm = new aws.cloudwatch.MetricAlarm(
  "pathfinder-alb-unhealthy-hosts",
  {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "UnHealthyHostCount",
    namespace: "AWS/ApplicationELB",
    period: 60, // 1 minute
    statistic: "Average",
    threshold: 0,
    alarmDescription: "Triggers when ALB has unhealthy targets",
    dimensions: {
      LoadBalancer: lb.loadBalancer.arnSuffix,
      TargetGroup: lb.defaultTargetGroup.arnSuffix,
    },
    treatMissingData: "notBreaching",
    tags: {
      ...commonTags,
      Name: "pathfinder-alb-unhealthy-alarm",
      Type: "monitoring",
    },
  }
);

const albResponseTimeAlarm = new aws.cloudwatch.MetricAlarm(
  "pathfinder-alb-high-response-time",
  {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "TargetResponseTime",
    namespace: "AWS/ApplicationELB",
    period: 60, // 1 minute
    statistic: "Average",
    threshold: 2, // 2 seconds
    alarmDescription: "Triggers when response time exceeds 2 seconds",
    dimensions: {
      LoadBalancer: lb.loadBalancer.arnSuffix,
    },
    treatMissingData: "notBreaching",
    tags: {
      ...commonTags,
      Name: "pathfinder-alb-response-time-alarm",
      Type: "monitoring",
    },
  }
);

// ==========================================
// BETTER STACK LOG FORWARDING
// Lambda function to forward CloudWatch logs to Better Stack
// ==========================================

// IAM role for the Better Stack Lambda function
const betterStackLambdaRole = new aws.iam.Role(
  "pathfinder-better-stack-lambda-role",
  {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "lambda.amazonaws.com",
          },
        },
      ],
    }),
    tags: {
      ...commonTags,
      Name: "pathfinder-better-stack-lambda-role",
      Type: "iam-role",
    },
  }
);

// Attach basic Lambda execution policy
new aws.iam.RolePolicyAttachment(
  "pathfinder-better-stack-lambda-basic-execution",
  {
    role: betterStackLambdaRole.name,
    policyArn:
      "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
  }
);

// Custom policy for reading from CloudWatch Logs
const betterStackLambdaPolicy = new aws.iam.Policy(
  "pathfinder-better-stack-lambda-policy",
  {
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          Resource: "arn:aws:logs:*:*:*",
        },
      ],
    }),
    tags: {
      ...commonTags,
      Name: "pathfinder-better-stack-lambda-policy",
      Type: "iam-policy",
    },
  }
);

new aws.iam.RolePolicyAttachment(
  "pathfinder-better-stack-lambda-policy-attachment",
  {
    role: betterStackLambdaRole.name,
    policyArn: betterStackLambdaPolicy.arn,
  }
);


// Automatically install Lambda dependencies during deployment
const installLambdaDeps = new command.local.Command("install-lambda-deps", {
  create: "npm install --production",
  dir: "../../logtail-aws-lambda",
  environment: {
    NODE_ENV: "production",
  },
});

// Create a deployment package for the Lambda function
const betterStackLambdaPackage = new pulumi.asset.FileArchive(
  "../../logtail-aws-lambda"
);

// Better Stack Lambda function
const betterStackLambda = new aws.lambda.Function(
  "pathfinder-better-stack-lambda",
  {
    name: "logtail-aws-lambda",
    role: betterStackLambdaRole.arn,
    handler: "index.handler",
    runtime: "nodejs22.x",
    architectures: ["x86_64"],
    code: betterStackLambdaPackage,
    timeout: 30,
    environment: {
      variables: {
        BETTER_STACK_ENTRYPOINT:
          "https://s1374763.eu-nbg-2.betterstackdata.com",
        BETTER_STACK_SOURCE_TOKEN: "1qUb5qfDVR8L5dvCUS872M4n",
      },
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-better-stack-lambda",
      Type: "log-forwarder",
    },
  },
  { dependsOn: [installLambdaDeps] }
);

// CloudWatch subscription filters to forward ALL logs to Better Stack
// 1. ECS Application logs
const betterStackECSSubscriptionFilter =
  new aws.cloudwatch.LogSubscriptionFilter(
    "pathfinder-better-stack-ecs-subscription-filter",
    {
      logGroup: logGroup.name,
      filterPattern: "", // Forward all logs
      destinationArn: betterStackLambda.arn,
      name: "logtail-aws-lambda-ecs-filter",
    }
  );

// 2. RDS PostgreSQL logs
const rdsLogGroupNameOutput = pulumi.interpolate`/aws/rds/instance/${db.id}/postgresql`;

// Create the RDS log group explicitly
const rdsLogGroup = new aws.cloudwatch.LogGroup(
  "pathfinder-rds-log-group",
  {
    name: rdsLogGroupNameOutput,
    retentionInDays: 7, // Keep logs for 7 days
    tags: {
      ...commonTags,
      Name: "pathfinder-rds-log-group",
      Type: "logging",
    },
  },
  { dependsOn: [db] } // Ensure RDS is created first
);

const betterStackRDSSubscriptionFilter =
  new aws.cloudwatch.LogSubscriptionFilter(
    "pathfinder-better-stack-rds-subscription-filter",
    {
      logGroup: rdsLogGroup.name,
      filterPattern: "", // Forward all logs
      destinationArn: betterStackLambda.arn,
      name: "logtail-aws-lambda-rds-filter",
    },
    { dependsOn: [rdsLogGroup] } // Ensure log group is created first
  );

// Grant CloudWatch Logs permission to invoke the Lambda function from ECS
const betterStackLambdaPermissionECS = new aws.lambda.Permission(
  "pathfinder-better-stack-lambda-permission-ecs",
  {
    statementId: "AllowExecutionFromCloudWatchLogsECS",
    action: "lambda:InvokeFunction",
    function: betterStackLambda.name,
    principal: "logs.amazonaws.com",
    sourceArn: pulumi.interpolate`${logGroup.arn}:*`,
  }
);

// Grant CloudWatch Logs permission to invoke the Lambda function from RDS
const betterStackLambdaPermissionRDS = new aws.lambda.Permission(
  "pathfinder-better-stack-lambda-permission-rds",
  {
    statementId: "AllowExecutionFromCloudWatchLogsRDS",
    action: "lambda:InvokeFunction",
    function: betterStackLambda.name,
    principal: "logs.amazonaws.com",
    sourceArn: pulumi.interpolate`arn:aws:logs:${aws.config.region}:${aws
      .getCallerIdentity()
      .then((id) => id.accountId)}:log-group:/aws/rds/instance/${
      db.id
    }/postgresql:*`,
  }
);

// ==========================================
// STACK OUTPUTS
// Values accessible after deployment
// ==========================================

export const url = lb.loadBalancer.dnsName.apply((dns) => `http://${dns}`);
export const dbEndpoint = db.endpoint;
export const dbConnectionString = pulumi.interpolate`postgresql://${db.username}:${db.password}@${db.endpoint}/${db.dbName}`;
// Export password as a secret - only visible via CLI with --show-secrets flag
export const dbPasswordSecret = pulumi.secret(dbPassword.result);
export const dbUsername = db.username;

// Migration information
export const migrationTaskArn = migrationTaskDef.arn;
export const migrationStatus = buildImagesAndMigrate.stdout;

// Better Stack logging information
export const betterStackLambdaArn = betterStackLambda.arn;
export const betterStackLambdaName = betterStackLambda.name;
export const logGroupName = logGroup.name;
export const rdsLogGroupName = rdsLogGroup.name;

// CodeBuild outputs for GitHub Actions integration
export const codeBuildProjectName = codeBuildProject.name;
export const ecrRepositoryUrl = repo.url;
