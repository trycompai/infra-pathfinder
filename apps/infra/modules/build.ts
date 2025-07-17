import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { CommonConfig, ContainerOutputs, DatabaseOutputs, NetworkOutputs } from "../types";

export function createBuildSystem(config: CommonConfig, network: NetworkOutputs, database: DatabaseOutputs, container: ContainerOutputs) {
  const { commonTags } = config;

  // IAM Service Role for CodeBuild
  const codebuildRole = new aws.iam.Role("pathfinder-codebuild-role", {
    name: "pathfinder-codebuild-role",
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
      Type: "iam-role",
    },
  });

  // CodeBuild policy for basic operations
  const codebuildPolicy = new aws.iam.RolePolicy("pathfinder-codebuild-policy", {
    role: codebuildRole.id,
    policy: database.secretArn.apply(secretArn => JSON.stringify({
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
        {
          Effect: "Allow",
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "ecr:GetAuthorizationToken",
            "ecr:PutImage",
            "ecr:InitiateLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:CompleteLayerUpload",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "ec2:CreateNetworkInterface",
            "ec2:DescribeDhcpOptions",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DeleteNetworkInterface",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeVpcs",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "ec2:CreateNetworkInterfacePermission",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
          ],
          Resource: secretArn,
        },
      ],
    })),
  });



  // CodeBuild project for building and deploying the application (includes migrations)
  const appProject = new aws.codebuild.Project("pathfinder-app-build", {
    name: "pathfinder-app",
    description: "Build project that runs migrations and deploys application to ECS",
    serviceRole: codebuildRole.arn,
    artifacts: {
      type: "NO_ARTIFACTS",
    },
    environment: {
      computeType: "BUILD_GENERAL1_MEDIUM",
      image: "aws/codebuild/standard:7.0",
      type: "LINUX_CONTAINER",
      privilegedMode: true, // Required for Docker builds
      environmentVariables: [
        {
          name: "AWS_ACCOUNT_ID",
          value: aws.getCallerIdentityOutput().accountId,
          type: "PLAINTEXT",
        },
        {
          name: "IMAGE_REPO_NAME",
          value: "pathfinder",
          type: "PLAINTEXT",
        },
        // DATABASE_URL not needed - migrations run separately
        {
          name: "ECR_REPOSITORY_URI",
          value: container.repositoryUrl,
          type: "PLAINTEXT",
        },
        {
          name: "ECS_CLUSTER_NAME",
          value: container.clusterName,
          type: "PLAINTEXT",
        },
        {
          name: "ECS_SERVICE_NAME",
          value: container.serviceName,
          type: "PLAINTEXT",
        },
        {
          name: "AWS_DEFAULT_REGION",
          value: config.awsRegion,
          type: "PLAINTEXT",
        },
        {
          name: "NODE_ENV",
          value: process.env.NODE_ENV || "production",
          type: "PLAINTEXT",
        },
            ],
    },
    // No VPC config needed - build process doesn't access database
    source: {
      type: "GITHUB",
      location: `https://github.com/${config.githubOrg}/${config.githubRepo}.git`,
      buildspec: "apps/web/buildspec.yml",
      gitCloneDepth: 1,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-app-build",
      Type: "codebuild-project",
      Purpose: "full-application-deployment",
    },
  });

  // Additional IAM permissions for ECS deployment
  const ecsDeployPolicy = new aws.iam.RolePolicy("pathfinder-ecs-deploy-policy", {
    role: codebuildRole.id,
    policy: pulumi.all([container.taskExecutionRoleArn, container.taskRoleArn]).apply(([taskExecRoleArn, taskRoleArn]: [string, string]) => JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "ecs:UpdateService",
            "ecs:DescribeServices",
            "ecs:DescribeTasks",
            "ecs:DescribeTaskDefinition",
            "ecs:RegisterTaskDefinition",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "iam:PassRole",
          ],
          Resource: [
            taskExecRoleArn,
            taskRoleArn,
          ],
        },
      ],
    })),
  });

  // Application deployment function
  function createApplicationDeployment(
    app: {
      name: string;
      contextPath: string;
      requiresDatabaseAccess: boolean;
      dependsOnMigrations: boolean;
      buildCommand: string;
      healthCheckPath: string;
      environmentVariables: Record<string, string>;
      resourceRequirements: { cpu: number; memory: number };
      scaling: { minInstances: number; maxInstances: number; targetCpuPercent: number };
    },
    database: DatabaseOutputs,
    container: ContainerOutputs
  ) {
    // Return deployment configuration for the application
    return {
      appName: app.name,
      contextPath: app.contextPath,
      // Single build command that does everything (migrations + app)
      buildCommands: {
        // Single step: Run the complete build (migrations + app + deploy)
        deployWithMigrations: `aws codebuild start-build --project-name ${appProject.name}`,
      },
      // Docker image reference
      containerImage: pulumi.interpolate`${container.repositoryUrl}:${app.name}-latest`,
      healthCheckPath: app.healthCheckPath,
      resourceRequirements: app.resourceRequirements,
      scaling: app.scaling,
      // Build project reference
      buildProject: appProject.name,
    };
  }

  return {
    appProjectName: appProject.name,
    appProjectArn: appProject.arn,
    codebuildRoleArn: codebuildRole.arn,
    buildInstanceType: "BUILD_GENERAL1_MEDIUM",
    buildTimeout: 20,
    createApplicationDeployment,
  };
} 