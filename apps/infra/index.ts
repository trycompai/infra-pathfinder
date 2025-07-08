import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

// VPC with public subnets for ALB and private subnets for containers
const vpc = new awsx.ec2.Vpc("pathfinder-vpc");

const cluster = new aws.ecs.Cluster("pathfinder-cluster");

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
  }
);

// Load Balancer with health checks
const lb = new awsx.lb.ApplicationLoadBalancer("pathfinder-lb", {
  subnetIds: vpc.publicSubnetIds,
  securityGroups: [albSecurityGroup.id],
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

// Logging
const logGroup = new aws.cloudwatch.LogGroup("pathfinder-logs", {
  retentionInDays: 7,
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
  forceDelete: true,
});

// This builds AND pushes your Docker image to ECR automatically:
// 1. Builds Docker image from ../web/Dockerfile on YOUR machine
// 2. Authenticates to ECR using your AWS credentials
// 3. Tags the image with the ECR repository URL
// 4. Pushes the image to ECR
// This happens during `pulumi up` - no separate docker push needed!
const image = new awsx.ecr.Image("pathfinder-image", {
  repositoryUrl: repo.url,
  context: "../web",
  platform: "linux/amd64", // Required for AWS Fargate
});

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
      image: image.imageUri,
      cpu: 512, // 0.5 vCPU
      memory: 1024, // 1GB - Next.js needs this
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

// Auto-scaling: 2-10 tasks based on CPU
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

export const url = lb.loadBalancer.dnsName.apply((dns) => `http://${dns}`);
