import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

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

// Database Security Group - only allow access from the service
const dbSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-db-sg", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      securityGroups: [serviceSecurityGroup.id], // Only allow from ECS service
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

// ==========================================
// DATABASE LAYER
// RDS PostgreSQL with auto-scaling storage
// ==========================================

// RDS Subnet Group - database should be in private subnets
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

// ECR for storing Docker images
const repo = new awsx.ecr.Repository("pathfinder-repo", {
  forceDelete: true, // Allow deletion even if images exist
  tags: {
    ...commonTags,
    Name: "pathfinder-repo",
    Type: "container-registry",
  },
});

// Always build Docker image locally and push to ECR
const imageUri = new awsx.ecr.Image("pathfinder-image", {
  repositoryUrl: repo.url,
  context: "../web",
  platform: "linux/amd64", // Required for AWS Fargate
}).imageUri;

// Fargate Service
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
    container: {
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
          "awslogs-stream-prefix": "pathfinder",
        },
      },
    },
  },
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
  }
);

// CloudWatch subscription filter to forward logs to Better Stack
const betterStackSubscriptionFilter = new aws.cloudwatch.LogSubscriptionFilter(
  "pathfinder-better-stack-subscription-filter",
  {
    logGroup: logGroup.name,
    filterPattern: "", // Forward all logs
    destinationArn: betterStackLambda.arn,
    name: "logtail-aws-lambda-filter",
  }
);

// Grant CloudWatch Logs permission to invoke the Lambda function
const betterStackLambdaPermission = new aws.lambda.Permission(
  "pathfinder-better-stack-lambda-permission",
  {
    statementId: "AllowExecutionFromCloudWatchLogs",
    action: "lambda:InvokeFunction",
    function: betterStackLambda.name,
    principal: "logs.amazonaws.com",
    sourceArn: pulumi.interpolate`${logGroup.arn}:*`,
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

// Better Stack logging information
export const betterStackLambdaArn = betterStackLambda.arn;
export const betterStackLambdaName = betterStackLambda.name;
export const logGroupName = logGroup.name;
