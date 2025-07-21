import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
  CommonConfig,
  DatabaseOutputs,
  LoadBalancerOutputs,
  NetworkOutputs,
} from "../types";

export function createContainer(
  config: CommonConfig,
  network: NetworkOutputs,
  database: DatabaseOutputs,
  loadBalancer?: LoadBalancerOutputs
) {
  const { commonTags } = config;

  // ECR Repository for container images
  const repository = new aws.ecr.Repository("pathfinder-repository", {
    name: "pathfinder",
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    encryptionConfigurations: [
      {
        encryptionType: "AES256",
      },
    ],
    tags: {
      ...commonTags,
      Name: "pathfinder-repository",
      Type: "ecr-repository",
    },
  });

  // ECR Lifecycle Policy
  const lifecyclePolicy = new aws.ecr.LifecyclePolicy(
    "pathfinder-lifecycle-policy",
    {
      repository: repository.name,
      policy: JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: "Keep last 10 production images",
            selection: {
              tagStatus: "tagged",
              tagPrefixList: ["prod"],
              countType: "imageCountMoreThan",
              countNumber: 10,
            },
            action: {
              type: "expire",
            },
          },
          {
            rulePriority: 2,
            description: "Keep last 5 development images",
            selection: {
              tagStatus: "tagged",
              tagPrefixList: ["dev"],
              countType: "imageCountMoreThan",
              countNumber: 5,
            },
            action: {
              type: "expire",
            },
          },
          {
            rulePriority: 3,
            description: "Delete untagged images older than 1 day",
            selection: {
              tagStatus: "untagged",
              countType: "sinceImagePushed",
              countUnit: "days",
              countNumber: 1,
            },
            action: {
              type: "expire",
            },
          },
        ],
      }),
    }
  );

  // ECS Cluster
  const cluster = new aws.ecs.Cluster("pathfinder-cluster", {
    name: "pathfinder",
    settings: [
      {
        name: "containerInsights",
        value: "enabled",
      },
    ],
    tags: {
      ...commonTags,
      Name: "pathfinder-cluster",
      Type: "ecs-cluster",
    },
  });

  // CloudWatch Log Group for application logs
  const logGroup = new aws.cloudwatch.LogGroup("pathfinder-app-logs", {
    name: "/aws/ecs/pathfinder",
    retentionInDays: config.logRetentionDays,
    tags: {
      ...commonTags,
      Name: "pathfinder-app-logs",
      Type: "log-group",
    },
  });

  // ECS Task Execution Role
  const taskExecutionRole = new aws.iam.Role("pathfinder-task-execution-role", {
    name: "pathfinder-ecs-task-execution-role",
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
    tags: {
      ...commonTags,
      Name: "pathfinder-task-execution-role",
      Type: "iam-role",
    },
  });

  // Attach the ECS task execution role policy
  const taskExecutionRolePolicyAttachment = new aws.iam.RolePolicyAttachment(
    "pathfinder-task-execution-role-policy",
    {
      role: taskExecutionRole.name,
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    }
  );

  // Add policy for Secrets Manager access to task execution role
  const taskExecutionSecretsPolicy = new aws.iam.RolePolicy(
    "pathfinder-task-execution-secrets-policy",
    {
      role: taskExecutionRole.id,
      policy: database.secretArn.apply((secretArn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
              ],
              Resource: secretArn,
            },
          ],
        })
      ),
    }
  );

  // ECS Task Role for application permissions
  const taskRole = new aws.iam.Role("pathfinder-task-role", {
    name: "pathfinder-ecs-task-role",
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
    tags: {
      ...commonTags,
      Name: "pathfinder-task-role",
      Type: "iam-role",
    },
  });

  // Task Role Policy for application access
  const taskRolePolicy = new aws.iam.RolePolicy("pathfinder-task-role-policy", {
    role: taskRole.id,
    policy: logGroup.arn.apply((logGroupArn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: logGroupArn,
          },
        ],
      })
    ),
  });

  // ECS Task Definition
  const taskDefinition = new aws.ecs.TaskDefinition("pathfinder-task", {
    family: "pathfinder",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "1024",
    memory: "2048",
    executionRoleArn: taskExecutionRole.arn,
    taskRoleArn: taskRole.arn,
    containerDefinitions: pulumi
      .all([repository.repositoryUrl, logGroup.name, database.secretArn])
      .apply(([repoUrl, logGroupName, secretArn]: [string, string, string]) =>
        JSON.stringify([
          {
            name: "pathfinder-app",
            image: `${repoUrl}:latest`,
            essential: true,
            portMappings: [
              {
                containerPort: 3000,
                protocol: "tcp",
              },
            ],
            environment: [
              {
                name: "NODE_ENV",
                value: "production",
              },
              {
                name: "PORT",
                value: "3000",
              },
            ],
            secrets: [
              {
                name: "DATABASE_URL",
                valueFrom: secretArn,
              },
            ],
            logConfiguration: {
              logDriver: "awslogs",
              options: {
                "awslogs-group": logGroupName,
                "awslogs-region": config.awsRegion,
                "awslogs-stream-prefix": "ecs",
              },
            },
            healthCheck: {
              command: [
                "CMD-SHELL",
                "curl -f http://localhost:3000/health || exit 1",
              ],
              interval: 30,
              timeout: 5,
              retries: 3,
              startPeriod: 60,
            },
          },
        ])
      ),
    tags: {
      ...commonTags,
      Name: "pathfinder-task",
      Type: "ecs-task-definition",
    },
  });

  // ECS Service
  const service = new aws.ecs.Service("pathfinder-service", {
    name: "pathfinder",
    cluster: cluster.id,
    taskDefinition: taskDefinition.arn,
    desiredCount: 2,
    launchType: "FARGATE",
    platformVersion: "LATEST",
    networkConfiguration: {
      subnets: network.privateSubnetIds,
      securityGroups: [network.securityGroups.ecs],
      assignPublicIp: false,
    },
    enableExecuteCommand: config.environment !== "prod",
    // Attach to load balancer if provided
    loadBalancers: loadBalancer
      ? [
          {
            targetGroupArn: loadBalancer.targetGroupArn,
            containerName: "pathfinder-app",
            containerPort: 3000,
          },
        ]
      : undefined,
    tags: {
      ...commonTags,
      Name: "pathfinder-service",
      Type: "ecs-service",
    },
  });

  return {
    clusterName: cluster.name,
    clusterArn: cluster.arn,
    serviceName: service.name,
    repositoryUrl: repository.repositoryUrl,
    repositoryArn: repository.arn,
    taskDefinitionArn: taskDefinition.arn,
    logGroupName: logGroup.name,
    logGroupArn: logGroup.arn,
    taskExecutionRoleArn: taskExecutionRole.arn,
    taskRoleArn: taskRole.arn,
  };
}
