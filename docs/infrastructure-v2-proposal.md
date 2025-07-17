# Infrastructure V2 Requirements Document
**Pathfinder Infrastructure Redesign: A Comprehensive Technical Specification**

---

## Executive Summary

The current Pathfinder infrastructure is a 588-line monolithic configuration that creates maintenance, security, and scalability problems. This document outlines a modular redesign that addresses these issues.

Three critical problems drive this redesign: our database is publicly exposed with broad access controls, our build process cannot access private resources during build time, and our infrastructure code is a single, complex file that's difficult to debug and extend.

The solution is a modular architecture with focused components, proper security boundaries, and build processes that can access private resources during compilation.

---

## Current State Analysis

### Infrastructure Complexity Problem

Our current infrastructure is a single 588-line TypeScript file mixing networking, security, database, container orchestration, and monitoring concerns.

When a component fails - like load balancer health checks - we must navigate hundreds of lines of mixed concerns to find the relevant configuration. This complexity increases when understanding dependencies or making changes across multiple domains.

Our approach makes it difficult to test individual components in isolation. Database changes cannot be validated without potentially affecting the entire networking stack because all configurations are tightly coupled.

### Security Architecture Concerns

Our PostgreSQL instance is deployed in public subnets with security group rules allowing access from `0.0.0.0/0` - the entire internet. While we use SSL certificates and strong passwords, this exposes us to attack vectors:

Port scanning tools can discover our database endpoint for automated attacks. Brute force attacks are feasible because the database port is directly accessible. Any PostgreSQL vulnerabilities could be exploited directly against our public instance.

This configuration complicates development workflow. Developers cannot easily access the database for debugging without the same broad network access that creates security risks.

### Build Process Limitations

Our build architecture relies on local Docker environments and GitHub Actions runners that cannot access private AWS resources during build time. This creates architectural compromises affecting performance.

Our Next.js application cannot perform static site generation (SSG) with database content because the build environment cannot reach our private database. This forces runtime data fetching for content that could be statically generated, resulting in slower page loads and increased server resource utilization.

Our approach requires coordination between local development environments and AWS infrastructure. Developers must maintain Docker installations locally and ensure their build environments match production configuration, creating opportunities for environment-specific bugs.

---

## Proposed Architecture

### Modular Infrastructure Design

The proposed architecture transforms our monolithic infrastructure into focused, single-responsibility modules that can be developed, tested, and maintained independently.

```
apps/infra/
├── index_v2.ts                 # Orchestration layer (80-100 lines)
├── package.json               # Dependencies including @pulumi/tailscale
├── modules/                    # Infrastructure modules
│   ├── config.ts              # Environment and shared configuration
│   ├── networking.ts          # VPC, subnets, and security groups
│   ├── database.ts            # Private RDS with proper security
│   ├── container.ts           # ECR repositories and ECS infrastructure
│   ├── build.ts               # CodeBuild with VPC database access
│   ├── loadbalancer.ts        # Application Load Balancer configuration
│   ├── tailscale.ts           # Tailscale provider + EC2 subnet router
│   ├── monitoring.ts          # Observability and logging
│   └── scaling.ts             # Auto-scaling policies
├── types.ts                   # Shared interfaces and type definitions
├── utils.ts                   # Common infrastructure utilities
└── buildspecs/                # CodeBuild specifications
    ├── migration.yml          # Database migration build process
    └── app.yml                # Application build process
```

Each module maintains a clear interface with explicit dependencies, making it possible to understand and modify individual components without affecting unrelated infrastructure. For example, adjusting database configuration only requires changes to the `database.ts` module.

### Security Architecture Transformation

The new architecture moves our database to private subnets and provides secure access mechanisms for applications and developers.

Our database will be deployed in private subnets with no direct internet connectivity. Security groups will restrict access to only our ECS services, eliminating broad network exposure.

For development access, we're implementing Tailscale subnet routing using the [official Pulumi Tailscale provider](https://www.pulumi.com/registry/packages/tailscale/installation-configuration/). This approach manages Tailscale resources directly through infrastructure as code, providing secure, authenticated access to our private infrastructure.

```typescript
// Example: Tailscale subnet router using official Pulumi provider
import * as tailscale from "@pulumi/tailscale";

// Create subnet router for private network access
const subnetRouter = new tailscale.Device("pathfinder-subnet-router", {
  name: "pathfinder-aws-router",
  tags: ["subnet-router", "aws", "pathfinder"],
  routes: [
    privateSubnet1.cidrBlock,
    privateSubnet2.cidrBlock
  ]
});

// Approve the subnet routes (can be done manually in Tailscale admin console)
const approvedRoutes = new tailscale.DeviceSubnetRoutes("pathfinder-approved-routes", {
  deviceId: subnetRouter.id,
  routes: [
    privateSubnet1.cidrBlock,
    privateSubnet2.cidrBlock
  ]
});

// Still need a small EC2 instance to run the actual Tailscale client
const tailscaleRouter = new aws.ec2.Instance("pathfinder-tailscale-router", {
  instanceType: "t3.nano", // ~$3/month
  ami: "ami-0abcdef1234567890", // Amazon Linux 2
  subnetId: publicSubnet.id,
  securityGroups: [tailscaleSecurityGroup.id],
  userData: pulumi.interpolate`#!/bin/bash
    # Install Tailscale
    curl -fsSL https://tailscale.com/install.sh | sh
    
    # Authenticate and enable subnet routing
    tailscale up --authkey=${tailscaleAuthKey} --advertise-routes=${privateSubnet1.cidrBlock},${privateSubnet2.cidrBlock} --accept-routes
    
    # Enable IP forwarding
    echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
    sysctl -p
  `,
  tags: {
    Name: "pathfinder-tailscale-router",
    Purpose: "development-access"
  }
});
```

This configuration uses the official Tailscale provider to manage devices and routes declaratively, while still requiring a small EC2 instance to run the actual Tailscale client. Developers can connect to the database directly from their local machines through the Tailscale network with proper authentication and authorization.

### Build System Revolution

The most significant architectural change involves moving our build process into AWS CodeBuild instances that run within our VPC, providing them with access to private resources during build time.

Our current limitation - where build processes cannot access the database for static site generation - is resolved by deploying CodeBuild projects within our VPC's private subnets. These build environments can connect to our private database, enabling Next.js to perform database queries during the build process and generate static pages with real content.

```yaml
# buildspec.yml - Application build with database access
version: 0.2
env:
  variables:
    NODE_ENV: "production"
phases:
  pre_build:
    commands:
      - echo "Build environment has database access at $DATABASE_URL"
      - echo "Installing dependencies..."
      - npm install
      
  build:
    commands:
      - echo "Running Next.js build with database access for SSG..."
      - npm run build  # Next.js can query database for static generation
      - echo "Building Docker image..."
      - docker build -t $ECR_REPOSITORY_URI:$IMAGE_TAG .
      
  post_build:
    commands:
      - echo "Pushing image to ECR..."
      - docker push $ECR_REPOSITORY_URI:$IMAGE_TAG
      - echo "Build completed successfully"
```

This approach eliminates the need for local Docker environments while providing superior build capabilities. Builds run in consistent AWS environments with access to the same resources available to our production applications, eliminating environment-specific issues and enabling advanced build-time optimizations.

### Image Versioning and Deployment Strategy

Our current image tagging approach has created deployment issues where ECS services fail to recognize when new images are available. The new architecture implements deterministic image versioning that ensures reliable deployments while providing clear traceability.

```typescript
// Deterministic image tag generation
const generateImageTag = (environment: string, gitCommit: string): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const shortCommit = gitCommit.substring(0, 7);
  return `${environment}-${shortCommit}-${timestamp}`;
};

// Example tag: "prod-a7b8c9d-2024-12-01"
```

This tagging strategy ensures that every deployment uses a unique image identifier that cannot be confused with previous versions. The tag format includes the environment (preventing accidental cross-environment deployments), the git commit hash (providing traceability to source code), and a timestamp (ensuring uniqueness even for multiple builds of the same commit).

---

## Implementation Specifications

### Main Orchestration Layer

The new `index_v2.ts` file serves as a thin orchestration layer that coordinates module instantiation and manages dependencies between infrastructure components. This approach keeps the main file focused and readable while delegating complex logic to specialized modules.

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as tailscale from "@pulumi/tailscale";
import { createConfig } from "./modules/config";
import { createNetworking } from "./modules/networking";
import { createDatabase } from "./modules/database";
import { createContainer } from "./modules/container";
import { createBuildSystem } from "./modules/build";
import { createLoadBalancer } from "./modules/loadbalancer";
import { createTailscale } from "./modules/tailscale";
import { createMonitoring } from "./modules/monitoring";
import { createScaling } from "./modules/scaling";

// Configuration initialization
const config = createConfig();

// Infrastructure dependency chain - order matters
const network = createNetworking(config);
const database = createDatabase(config, network);
const container = createContainer(config, network);
const build = createBuildSystem(config, network, database, container);
const loadBalancer = createLoadBalancer(config, network, container);
const tailscale = createTailscale(config, network, database);
const monitoring = createMonitoring(config, database, container, loadBalancer);
const scaling = createScaling(config, container, loadBalancer);

// Multi-application deployment configuration
const applications = [
  {
    name: "pathfinder-web",
    contextPath: "../web",
    requiresDatabaseAccess: true,
    dependsOnMigrations: true,
    environment: {
      NODE_ENV: "production",
      HOSTNAME: "0.0.0.0",
      PORT: "3000"
    }
  }
];

// Deploy configured applications
const deployments = applications.map(app => 
  build.createApplicationDeployment(app, database, container)
);

// Export critical infrastructure information
export const applicationUrl = loadBalancer.dnsName;
export const databaseEndpoint = database.endpoint;
export const tailscaleRouterAddress = tailscale.publicIP;
export const repositoryUrl = container.repositoryUrl;
```

This orchestration pattern makes dependencies explicit and ensures that infrastructure components are created in the correct order. The pattern also makes it easy to understand the overall system architecture by reading the main file, while keeping implementation details encapsulated in their respective modules.

### Database Security Implementation

The database module implements a comprehensive security model that addresses our current vulnerabilities while maintaining operational flexibility.

```typescript
// database.ts - Private database with proper security
export function createDatabase(config: CommonConfig, network: NetworkingInfra): DatabaseInfra {
  // Database subnet group in private subnets only
  const dbSubnetGroup = new aws.rds.SubnetGroup("pathfinder-db-subnet-group", {
    subnetIds: network.privateSubnetIds,
    description: "Subnet group for private database access",
    tags: config.tags
  });

  // Security group allowing access only from ECS services
  const dbSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-db-security-group", {
    vpcId: network.vpcId,
    description: "Database security group - private access only",
    ingress: [
      {
        protocol: "tcp",
        fromPort: 5432,
        toPort: 5432,
        securityGroups: [network.ecsSecurityGroupId],
        description: "PostgreSQL access from ECS services only"
      }
    ],
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Outbound traffic for updates and maintenance"
      }
    ],
    tags: { ...config.tags, Name: "pathfinder-database-security-group" }
  });

  // RDS instance in private subnets
  const dbInstance = new aws.rds.Instance("pathfinder-database", {
    engine: "postgres",
    engineVersion: "15.13",
    instanceClass: config.database.instanceClass,
    allocatedStorage: config.database.allocatedStorage,
    storageEncrypted: true,
    dbName: "pathfinder",
    username: "pathfinder_admin",
    password: dbPassword.result,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    dbSubnetGroupName: dbSubnetGroup.name,
    publiclyAccessible: false, // Critical: no public access
    backupRetentionPeriod: config.database.backupRetentionPeriod,
    deletionProtection: config.database.deletionProtection,
    tags: { ...config.tags, Name: "pathfinder-database" }
  });

  return {
    instance: dbInstance,
    endpoint: dbInstance.endpoint,
    connectionString: pulumi.interpolate`postgresql://${dbInstance.username}:${dbPassword.result}@${dbInstance.endpoint}:5432/${dbInstance.dbName}?sslmode=require`,
    securityGroup: dbSecurityGroup
  };
}
```

This implementation ensures that the database exists only in private network space and can only be accessed by authorized ECS services. The security group configuration is explicit about allowed connections, making it easy to audit and understand the access model.

### CodeBuild Integration with VPC Access

The build system module creates CodeBuild projects that run within our VPC, providing them with access to private resources while maintaining build isolation and security.

```typescript
// build.ts - VPC-enabled CodeBuild for database access
export function createBuildSystem(
  config: CommonConfig, 
  network: NetworkingInfra, 
  database: DatabaseInfra, 
  container: ContainerInfra
): BuildSystemInfra {
  
  // Build security group allowing database access
  const buildSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-build-security-group", {
    vpcId: network.vpcId,
    description: "Security group for CodeBuild projects",
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Full outbound access for builds"
      }
    ],
    tags: { ...config.tags, Name: "pathfinder-build-security-group" }
  });

  // Allow build projects to access database
  const buildDatabaseAccess = new aws.ec2.SecurityGroupRule("build-database-access", {
    type: "ingress",
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    sourceSecurityGroupId: buildSecurityGroup.id,
    securityGroupId: database.securityGroup.id,
    description: "Allow CodeBuild to access database for builds"
  });

  // Application build project with VPC configuration
  const appBuildProject = new aws.codebuild.Project("pathfinder-app-build", {
    description: "Build project for Pathfinder application with database access",
    serviceRole: buildRole.arn,
    
    // VPC configuration enables private resource access
    vpcConfig: {
      vpcId: network.vpcId,
      subnets: network.privateSubnetIds,
      securityGroupIds: [buildSecurityGroup.id]
    },
    
    environment: {
      type: "LINUX_CONTAINER",
      computeType: "BUILD_GENERAL1_MEDIUM",
      image: "aws/codebuild/amazonlinux2-x86_64-standard:4.0",
      privilegedMode: true, // Required for Docker builds
      environmentVariables: [
        {
          name: "DATABASE_URL",
          value: database.connectionString
        },
        {
          name: "ECR_REPOSITORY_URI",
          value: container.repositoryUrl
        },
        {
          name: "AWS_DEFAULT_REGION",
          value: aws.getRegionOutput().name
        }
      ]
    },
    
    source: {
      type: "S3",
      location: pulumi.interpolate`${sourceBucket.bucket}/source.zip`,
      buildspec: "buildspecs/app.yml"
    },
    
    cache: {
      type: "S3",
      location: pulumi.interpolate`${cacheBucket.bucket}/cache`,
      modes: ["LOCAL_DOCKER_LAYER_CACHE", "LOCAL_SOURCE_CACHE"]
    },
    
    tags: { ...config.tags, Name: "pathfinder-app-build" }
  });

  return {
    appBuildProject,
    buildSecurityGroup,
    triggerBuild: createBuildTrigger(appBuildProject, database)
  };
}
```

This configuration allows CodeBuild projects to access our private database during build time, enabling sophisticated build processes like static site generation with real data. The VPC configuration ensures that builds run in the same network environment as our production applications, eliminating environment-specific issues.

### Monitoring and Observability Integration

The monitoring module implements comprehensive observability across all infrastructure components, with particular focus on Better Stack integration for centralized log management.

```typescript
// monitoring.ts - Comprehensive observability implementation
export function createMonitoring(
  config: CommonConfig,
  database: DatabaseInfra,
  container: ContainerInfra,
  loadBalancer: LoadBalancerInfra
): MonitoringInfra {

  // Lambda function for log forwarding to Better Stack
  const logForwarder = new aws.lambda.Function("pathfinder-log-forwarder", {
    runtime: "nodejs18.x",
    handler: "index.handler",
    role: logForwarderRole.arn,
    code: new pulumi.asset.FileArchive("./lambda/log-forwarder"),
    timeout: 30,
    environment: {
      variables: {
        BETTER_STACK_ENTRYPOINT: config.betterStack.entrypoint,
        BETTER_STACK_SOURCE_TOKEN: config.betterStack.sourceToken
      }
    },
    vpcConfig: {
      subnetIds: network.privateSubnetIds,
      securityGroupIds: [logForwarderSecurityGroup.id]
    },
    tags: { ...config.tags, Name: "pathfinder-log-forwarder" }
  });

  // CloudWatch subscription filters for comprehensive log collection
  const subscriptionFilters = [
    // ECS application logs
    new aws.cloudwatch.LogSubscriptionFilter("ecs-logs-subscription", {
      logGroup: container.logGroup.name,
      filterPattern: "", // Forward all logs
      destinationArn: logForwarder.arn,
      name: "pathfinder-ecs-logs"
    }),
    
    // Database logs
    new aws.cloudwatch.LogSubscriptionFilter("database-logs-subscription", {
      logGroup: database.logGroup.name,
      filterPattern: "",
      destinationArn: logForwarder.arn,
      name: "pathfinder-database-logs"
    }),
    
    // Load balancer access logs
    new aws.cloudwatch.LogSubscriptionFilter("alb-logs-subscription", {
      logGroup: loadBalancer.accessLogGroup.name,
      filterPattern: "",
      destinationArn: logForwarder.arn,
      name: "pathfinder-alb-logs"
    })
  ];

  // Comprehensive CloudWatch alarms
  const alarms = createComprehensiveAlarms(config, database, container, loadBalancer);

  return {
    logForwarder,
    subscriptionFilters,
    alarms,
    dashboards: createMonitoringDashboards(config, database, container, loadBalancer)
  };
}
```

This monitoring implementation provides complete visibility into application behavior and infrastructure health, with automated forwarding to Better Stack for advanced log analysis and alerting capabilities.

---

## Environment Variables: When, What, How, and Which

### When Environment Variables Are Set

Environment variables are configured at three distinct times during the infrastructure lifecycle:

**Initial Setup (One-time)**: Set during first deployment of each environment. These variables rarely change and include authentication keys, service endpoints, and environment-specific configuration.

**Deployment Time (Pulumi)**: Set automatically by Pulumi during infrastructure deployment. These variables are computed from infrastructure resources and injected into build and runtime environments.

**Build Time (CodeBuild)**: Set by CodeBuild projects during application builds. These include computed values like image tags, git metadata, and resource URIs that change with each build.

**Runtime (ECS)**: Set in ECS task definitions when containers start. These provide applications with database connections, service endpoints, and operational configuration.

### What Variables Are Required

**Authentication and Secrets**:
- `tailscale:apiKey` - Tailscale API key for Pulumi provider
- `tailscale:tailnet` - Tailscale tailnet identifier
- `tailscale:authKey` - Tailscale device auth key for EC2 instance
- `betterstack:entrypoint` - Better Stack log ingestion endpoint
- `betterstack:sourceToken` - Better Stack authentication token
- Database passwords (auto-generated, managed by Pulumi)

**Build Configuration**:
- `DATABASE_URL` - Database connection string for build-time access
- `ECR_REPOSITORY_URI` - Container registry location
- `AWS_DEFAULT_REGION` - AWS region for builds
- `BRANCH_NAME` - Git branch being built
- `GIT_COMMIT` - Git commit hash

**Runtime Configuration**:
- `NODE_ENV` - Application environment (production/development)
- `HOSTNAME` - Container binding address (0.0.0.0 for ECS)
- `PORT` - Application port number
- `DATABASE_URL` - Runtime database connection

### How Variables Are Set

**Pulumi Configuration (Secrets)**:
```bash
# Set encrypted secrets for sensitive data
pulumi config set --secret tailscale:apiKey tskey-api-xxxxxxxxxxxxxxx
pulumi config set tailscale:tailnet your-tailnet-name.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-xxxxxxxxxxxxxxx
pulumi config set --secret betterstack:entrypoint https://in.logs.betterstack.com
pulumi config set --secret betterstack:sourceToken bt-xxxxxxxxxxxxxxxxx
```

**Pulumi Configuration (Non-sensitive)**:
```bash
# Set environment-specific configuration
pulumi config set aws:region us-east-1
pulumi config set pathfinder:environment dev
```

**CodeBuild Environment Variables**:
```typescript
// Automatically injected by Pulumi into CodeBuild projects
environment: {
  environmentVariables: [
    {
      name: "DATABASE_URL",
      value: database.connectionString  // Computed from infrastructure
    },
    {
      name: "ECR_REPOSITORY_URI",
      value: container.repositoryUrl    // Computed from ECR resource
    }
  ]
}
```

**ECS Task Definition Variables**:
```typescript
// Set in ECS container definitions
environment: [
  {
    name: "DATABASE_URL",
    value: pulumi.interpolate`postgresql://${db.username}:${db.password}@${db.endpoint}:5432/${db.dbName}?sslmode=require`
  },
  {
    name: "NODE_ENV",
    value: "production"
  }
]
```

**CI/CD Pipeline Variables** (GitHub Actions):
```yaml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
  GIT_BRANCH: ${{ github.ref_name }}
  GIT_COMMIT: ${{ github.sha }}
```

### Which Variables Are Required for Which Operations

**Local Development**:
- Required: AWS credentials (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`)
- Required: Pulumi access token (if using Pulumi Cloud)
- Optional: Tailscale credentials (only if deploying Tailscale router)
  - `tailscale:apiKey` - For Pulumi provider
  - `tailscale:tailnet` - Your tailnet name
  - `tailscale:authKey` - For EC2 instance authentication
- Optional: Better Stack credentials (only if deploying monitoring)

**CI/CD Deployment**:
- Required: AWS credentials (in GitHub secrets)
- Required: Pulumi access token
- Required: All Pulumi config secrets (must be set in target environment)
- Automatic: Git metadata (`GIT_BRANCH`, `GIT_COMMIT`)

**CodeBuild Processes**:
- Automatic: Database connection string (injected by Pulumi)
- Automatic: ECR repository URI (computed from infrastructure)
- Automatic: AWS region and credentials (from build environment)
- Automatic: Image tag (computed from git metadata and timestamp)

**ECS Runtime**:
- Automatic: Database connection string (from task definition)
- Automatic: Application configuration (NODE_ENV, HOSTNAME, PORT)
- Automatic: AWS credentials (from ECS task role)

### Environment-Specific Variable Management

**Development Environment** (dev stack):
```bash
pulumi stack select dev

# Enable features (defaults are all false)
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set pathfinder:enableDetailedMonitoring false

# Configure secrets (only if features are enabled)
pulumi config set --secret tailscale:apiKey tskey-api-dev-xxxxxxxx
pulumi config set tailscale:tailnet your-dev-tailnet.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-dev-xxxxxxxx

# Automatic environment-specific settings:
# Database instance class: db.t3.small
# Deletion protection: false
# Log retention: 3 days
```

**Production Environment** (prod stack):
```bash
pulumi stack select prod

# Enable features for production
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set pathfinder:enableDetailedMonitoring true

# Configure secrets (only if features are enabled)
pulumi config set --secret tailscale:apiKey tskey-api-prod-xxxxxxxx
pulumi config set tailscale:tailnet your-prod-tailnet.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-prod-xxxxxxxx

# Automatic environment-specific settings:
# Database instance class: db.t3.medium
# Deletion protection: true
# Log retention: 30 days
```

### Variable Security Best Practices

**Never commit to version control**:
- Authentication tokens
- Database passwords
- API keys
- Any Pulumi config secrets

**Use Pulumi secrets for**:
- External service authentication (Tailscale, Better Stack)
- Any configuration that should be encrypted at rest

**Use environment variables for**:
- Non-sensitive configuration (region, environment names)
- Values that change between environments but aren't sensitive

**Use computed values for**:
- Database connection strings (automatically generated)
- Resource URIs (computed from infrastructure)
- Image tags (generated from git metadata)

---

## Environment Configuration and Management

### Configuration Hierarchy and Security

The new architecture implements a sophisticated configuration management system that handles sensitive information securely while providing flexibility for different deployment environments.

Configuration management operates on three distinct levels, each with appropriate security controls. At the highest security level, truly sensitive information like database passwords and API keys are managed through AWS Secrets Manager, ensuring they never appear in configuration files or deployment logs.

Medium-sensitivity configuration, such as service endpoints and feature flags, is handled through Pulumi's encrypted configuration system. This approach keeps sensitive information encrypted at rest while making it available to infrastructure code during deployment.

Low-sensitivity configuration, including environment names and basic application settings, is managed through standard environment variables and can be safely stored in version control.

```typescript
// config.ts - Environment-aware configuration management
export function createConfig(): CommonConfig {
  const stack = pulumi.getStack(); // dev, staging, prod
  const gitBranch = process.env.GIT_BRANCH || getGitBranch();
  const gitCommit = process.env.GIT_COMMIT || getGitCommit();
  
  // Base configuration applicable to all environments
  const baseConfig = {
    projectName: "pathfinder",
    region: aws.getRegion(),
    environment: stack,
    gitBranch,
    gitCommit,
    tags: {
      Project: "pathfinder",
      Environment: stack,
      GitBranch: gitBranch,
      GitCommit: gitCommit,
      ManagedBy: "pulumi",
      Owner: "platform-team",
      CreatedDate: new Date().toISOString().split('T')[0]
    }
  };

  // Environment-specific configurations
  const environmentConfigs = {
    dev: {
      database: {
        instanceClass: "db.t3.small",
        allocatedStorage: 20,
        maxAllocatedStorage: 100,
        deletionProtection: false,
        backupRetentionPeriod: 3
      },
      scaling: {
        minCapacity: 1,
        maxCapacity: 3,
        targetCpuUtilization: 70
      },
      monitoring: {
        logRetentionDays: 3,
        detailedMonitoring: false
      }
    },
    staging: {
      database: {
        instanceClass: "db.t3.small",
        allocatedStorage: 50,
        maxAllocatedStorage: 200,
        deletionProtection: false,
        backupRetentionPeriod: 7
      },
      scaling: {
        minCapacity: 2,
        maxCapacity: 5,
        targetCpuUtilization: 60
      },
      monitoring: {
        logRetentionDays: 7,
        detailedMonitoring: true
      }
    },
    prod: {
      database: {
        instanceClass: "db.t3.medium",
        allocatedStorage: 100,
        maxAllocatedStorage: 1000,
        deletionProtection: true,
        backupRetentionPeriod: 30
      },
      scaling: {
        minCapacity: 3,
        maxCapacity: 20,
        targetCpuUtilization: 50
      },
      monitoring: {
        logRetentionDays: 30,
        detailedMonitoring: true
      }
    }
  };

  return {
    ...baseConfig,
    ...environmentConfigs[stack],
    // Sensitive configuration from Pulumi config
    betterStack: {
      entrypoint: new pulumi.Config("betterstack").requireSecret("entrypoint"),
      sourceToken: new pulumi.Config("betterstack").requireSecret("sourceToken")
    },
    tailscale: {
      authKey: new pulumi.Config("tailscale").requireSecret("authKey")
    }
  };
}
```

This configuration approach ensures that each environment has appropriate resource allocations and security settings while maintaining consistency in deployment patterns across all environments.

### Deployment Environment Setup

Setting up deployment environments requires careful attention to credential management and configuration sequencing. The process varies slightly between local development environments and CI/CD systems, but both follow the same fundamental security principles.

For local development, developers need AWS credentials with appropriate permissions for the target environment, Pulumi CLI installation, and access to the necessary secrets for the environment they're deploying. The setup process is designed to be straightforward while maintaining security controls:

```bash
# Local development environment setup
git clone https://github.com/your-org/pathfinder.git
cd pathfinder/apps/infra

# Install Pulumi CLI
curl -fsSL https://get.pulumi.com | sh
export PATH=$PATH:$HOME/.pulumi/bin

# Configure AWS credentials (choose one method)
export AWS_PROFILE=pathfinder-dev
# OR
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key

# Install infrastructure dependencies
cd apps/infra
npm install @pulumi/tailscale  # Install Tailscale provider

# Initialize Pulumi stack for your environment
pulumi stack init dev
pulumi config set aws:region us-east-1

# Configure required secrets
pulumi config set --secret tailscale:apiKey tskey-api-xxxxxxxxxxxxxxx
pulumi config set tailscale:tailnet your-tailnet-name.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-xxxxxxxxxxxxxxx
pulumi config set --secret betterstack:entrypoint https://in.logs.betterstack.com
pulumi config set --secret betterstack:sourceToken bt-xxxxxxxxxxxxxxxxx

# Deploy infrastructure
pulumi up
```

CI/CD environments require additional consideration for credential management and build automation. GitHub Actions or similar systems need access to secrets while ensuring they never appear in logs or are accessible to unauthorized users:

```yaml
# .github/workflows/deploy.yml - CI/CD deployment configuration
name: Deploy Infrastructure
on:
  push:
    branches: [main, release]
    paths: ['apps/infra/**', 'apps/web/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.ref == 'refs/heads/main' && 'dev' || 'prod' }}
    
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
      GIT_BRANCH: ${{ github.ref_name }}
      GIT_COMMIT: ${{ github.sha }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure Pulumi
        run: |
          curl -fsSL https://get.pulumi.com | sh
          export PATH=$PATH:$HOME/.pulumi/bin
          pulumi stack select ${{ github.ref == 'refs/heads/main' && 'dev' || 'prod' }}
      
      - name: Deploy Infrastructure
        run: |
          cd apps/infra
          pulumi up --yes
```

### Multi-Application Monorepo Support

The new architecture is designed from the ground up to support multiple applications within our monorepo structure. This capability addresses our anticipated growth where we'll need to deploy additional services like API backends, administrative interfaces, and specialized microservices.

The application configuration pattern provides a flexible framework for defining how different applications should be built and deployed, while sharing common infrastructure components like databases, networking, and monitoring systems.

```typescript
// Application configuration interface
interface ApplicationConfig {
  name: string;                    // Unique identifier for the application
  contextPath: string;             // Source code location relative to infra
  requiresDatabaseAccess: boolean; // Whether build process needs database
  dependsOnMigrations: boolean;    // Whether to wait for migrations
  buildCommand?: string;           // Custom build command override
  healthCheckPath: string;         // Load balancer health check endpoint
  environmentVariables: Record<string, string>; // App-specific variables
  resourceRequirements: {         // Container resource allocation
    cpu: number;
    memory: number;
  };
  scaling: {                      // Auto-scaling configuration
    minInstances: number;
    maxInstances: number;
    targetCpuPercent: number;
  };
}

// Example multi-application configuration
const applications: ApplicationConfig[] = [
  {
    name: "pathfinder-web",
    contextPath: "../web",
    requiresDatabaseAccess: true,  // Next.js SSG needs database
    dependsOnMigrations: true,
    healthCheckPath: "/health",
    environmentVariables: {
      NODE_ENV: "production",
      HOSTNAME: "0.0.0.0",
      PORT: "3000"
    },
    resourceRequirements: {
      cpu: 1024,
      memory: 2048
    },
    scaling: {
      minInstances: 2,
      maxInstances: 10,
      targetCpuPercent: 60
    }
  },
  {
    name: "pathfinder-api",
    contextPath: "../api",
    requiresDatabaseAccess: true,  // API server needs database
    dependsOnMigrations: true,
    healthCheckPath: "/api/health",
    environmentVariables: {
      NODE_ENV: "production",
      API_VERSION: "v1",
      PORT: "8080"
    },
    resourceRequirements: {
      cpu: 512,
      memory: 1024
    },
    scaling: {
      minInstances: 1,
      maxInstances: 5,
      targetCpuPercent: 70
    }
  },
  {
    name: "pathfinder-admin",
    contextPath: "../admin",
    requiresDatabaseAccess: false, // Static admin panel
    dependsOnMigrations: false,
    healthCheckPath: "/admin/health",
    environmentVariables: {
      NODE_ENV: "production",
      PORT: "9000"
    },
    resourceRequirements: {
      cpu: 256,
      memory: 512
    },
    scaling: {
      minInstances: 1,
      maxInstances: 2,
      targetCpuPercent: 80
    }
  }
];
```

This configuration approach makes it trivial to add new applications to our deployment pipeline. Each application can specify its unique requirements while benefiting from shared infrastructure components like the database, monitoring systems, and load balancing capabilities.

---

## Addendum: Tailscale Pulumi Provider Integration

**Update**: Tailscale provides an [official Pulumi provider](https://www.pulumi.com/registry/packages/tailscale/) (`@pulumi/tailscale`) that significantly improves our Tailscale integration approach.

### Benefits of Official Provider

**Declarative Resource Management**: The Tailscale provider allows us to manage Tailscale devices, routes, and permissions directly through Pulumi infrastructure as code, rather than relying on shell scripts and manual configuration.

**Better State Management**: Tailscale resources are now tracked in Pulumi state, enabling proper resource lifecycle management, dependency tracking, and rollback capabilities.

**Type Safety**: The provider includes TypeScript definitions, providing compile-time validation of Tailscale configuration and better IDE support.

### Implementation Impact

The official provider requires minimal changes to our proposed architecture:

- **Additional dependency**: `@pulumi/tailscale` package installation
- **Enhanced configuration**: API key and tailnet configuration in addition to device auth keys
- **Improved reliability**: Declarative resource management replaces imperative shell scripts

The combination of the Tailscale Pulumi provider for resource management and a small EC2 instance for the actual subnet routing provides the best of both worlds: infrastructure-as-code management with practical network connectivity.

---

## Multi-Environment Management and Feature Configuration

### Complete Environment Isolation

Each environment (dev, staging, prod) gets completely separate AWS resources using Pulumi stacks. This ensures zero cross-environment interference and allows for different configurations per environment.

```bash
# Create and configure development environment
pulumi stack init dev
pulumi config set aws:region us-east-1
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set --secret tailscale:apiKey tskey-api-dev-xxxxxxxx
pulumi config set tailscale:tailnet pathfinder-dev.ts.net

# Create and configure production environment  
pulumi stack init prod
pulumi config set aws:region us-east-1
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set --secret tailscale:apiKey tskey-api-prod-xxxxxxxx
pulumi config set tailscale:tailnet pathfinder-prod.ts.net

# Switch between environments
pulumi stack select dev    # Deploy to dev environment
pulumi stack select prod   # Deploy to prod environment
```

### How to Enable/Disable Features

Use `pulumi config set` with boolean values to control which optional services are deployed:

```bash
# Enable features (set to true)
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set pathfinder:enableDetailedMonitoring true

# Disable features (set to false) 
pulumi config set pathfinder:enableTailscale false
pulumi config set pathfinder:enableBetterStack false
pulumi config set pathfinder:enableDetailedMonitoring false

# Check current feature settings
pulumi config get pathfinder:enableTailscale
pulumi config get pathfinder:enableBetterStack
pulumi config get pathfinder:enableDetailedMonitoring

# View all pathfinder configuration
pulumi config
```

**Important**: Boolean values must be exactly `true` or `false` (lowercase). Invalid values will be treated as `false`.

**Default Values** (if not set):
- `enableTailscale`: `false` (Tailscale disabled)
- `enableBetterStack`: `false` (Better Stack disabled)  
- `enableDetailedMonitoring`: `false` (Basic monitoring only)

### Quick Feature Reference

| What you want | Command |
|---------------|---------|
| **Enable Tailscale** | `pulumi config set pathfinder:enableTailscale true` |
| **Disable Tailscale** | `pulumi config set pathfinder:enableTailscale false` |
| **Enable Better Stack** | `pulumi config set pathfinder:enableBetterStack true` |
| **Disable Better Stack** | `pulumi config set pathfinder:enableBetterStack false` |
| **Enable Detailed Monitoring** | `pulumi config set pathfinder:enableDetailedMonitoring true` |
| **Disable Detailed Monitoring** | `pulumi config set pathfinder:enableDetailedMonitoring false` |
| **Check what's enabled** | `pulumi config` |
| **Deploy minimal (no optional features)** | Don't set any feature flags (defaults to all `false`) |

### Feature Flag Configuration

The main `index_v2.ts` includes feature flags that control which services are deployed:

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as tailscale from "@pulumi/tailscale";
import { createConfig } from "./modules/config";
import { createNetworking } from "./modules/networking";
import { createDatabase } from "./modules/database";
import { createContainer } from "./modules/container";
import { createBuildSystem } from "./modules/build";
import { createLoadBalancer } from "./modules/loadbalancer";
import { createTailscale } from "./modules/tailscale";
import { createMonitoring } from "./modules/monitoring";
import { createScaling } from "./modules/scaling";

// ==========================================
// FEATURE CONFIGURATION
// ==========================================
const config = new pulumi.Config("pathfinder");
const enableTailscale = config.getBoolean("enableTailscale") ?? false;
const enableBetterStack = config.getBoolean("enableBetterStack") ?? false;
const enableDetailedMonitoring = config.getBoolean("enableDetailedMonitoring") ?? false;

// ==========================================
// INFRASTRUCTURE CONFIGURATION
// ==========================================
const infraConfig = createConfig();

// ==========================================
// CORE INFRASTRUCTURE (ALWAYS DEPLOYED)
// ==========================================

// 1. Foundation Layer - VPC, Subnets, Security Groups
const network = createNetworking(infraConfig);

// 2. Data Layer - Private RDS PostgreSQL
const database = createDatabase(infraConfig, network);

// 3. Container Platform - ECR, ECS Cluster
const container = createContainer(infraConfig, network);

// 4. Build System - CodeBuild with VPC Database Access
const build = createBuildSystem(infraConfig, network, database, container);

// 5. Load Balancing - ALB with Health Checks
const loadBalancer = createLoadBalancer(infraConfig, network, container);

// 6. Auto-scaling - ECS Service Scaling
const scaling = createScaling(infraConfig, container, loadBalancer);

// ==========================================
// OPTIONAL INFRASTRUCTURE (FEATURE-GATED)
// ==========================================

// 7. Development Access - Tailscale Subnet Router (Optional)
const tailscale = enableTailscale ? createTailscale(infraConfig, network, database) : undefined;

// 8. Observability - Better Stack + CloudWatch (Optional/Configurable)
const monitoring = createMonitoring(infraConfig, database, container, loadBalancer, {
  enableBetterStack,
  enableDetailedMonitoring
});

// ==========================================
// APPLICATION DEPLOYMENT
// ==========================================

const applications = [
  {
    name: "pathfinder-web",
    contextPath: "../web",
    requiresDatabaseAccess: true,
    dependsOnMigrations: true,
    environment: {
      NODE_ENV: "production",
      HOSTNAME: "0.0.0.0",
      PORT: "3000"
    }
  }
];

const deployments = applications.map(app => 
  build.createApplicationDeployment(app, database, container)
);

// ==========================================
// STACK OUTPUTS
// ==========================================

export const url = loadBalancer.dnsName;
export const environment = infraConfig.environment;

// Database connection information
export const database_endpoint = database.endpoint;
export const database_port = 5432;
export const database_name = database.dbName;
export const database_username = database.username;

// Tailscale-accessible database information (if Tailscale enabled)
export const tailscale_enabled = enableTailscale;
export const tailscale_database_host = enableTailscale ? database.privateAddress : undefined;
export const tailscale_database_url = enableTailscale 
  ? pulumi.interpolate`postgresql://${database.username}:${database.password}@${database.privateAddress}:5432/${database.dbName}?sslmode=require`
  : undefined;
export const tailscale_router_ip = enableTailscale ? tailscale?.publicIP : undefined;
export const tailscale_connection_guide = enableTailscale ? pulumi.interpolate`
# Connect to database through Tailscale:
# 1. Ensure you're connected to Tailscale network: ${infraConfig.tailscale?.tailnet}
# 2. Use this connection string: postgresql://${database.username}:[PASSWORD]@${database.privateAddress}:5432/${database.dbName}?sslmode=require
# 3. Get password with: pulumi stack output database_password --show-secrets
` : "Tailscale not enabled for this environment";

// Better Stack information (if enabled)
export const betterstack_enabled = enableBetterStack;
export const betterstack_lambda_arn = enableBetterStack ? monitoring.logForwarder?.arn : undefined;

// Repository and cluster information
export const ecr_repository_url = container.repositoryUrl;
export const ecs_cluster_name = container.clusterName;

// Security outputs (marked as secrets)
export const database_password = pulumi.secret(database.password);
export const tailscale_auth_key = enableTailscale ? pulumi.secret(tailscale?.authKey) : undefined;
```

### Environment-Specific Resource Configuration

The `config.ts` module handles environment-specific sizing and settings:

```typescript
// config.ts - Environment-aware configuration
export function createConfig(): CommonConfig {
  const stack = pulumi.getStack();
  const pathfinderConfig = new pulumi.Config("pathfinder");
  
  // Feature flags
  const enableTailscale = pathfinderConfig.getBoolean("enableTailscale") ?? false;
  const enableBetterStack = pathfinderConfig.getBoolean("enableBetterStack") ?? false;
  
  // Environment-specific configurations
  const environmentConfigs = {
    dev: {
      database: {
        instanceClass: "db.t3.small",
        allocatedStorage: 20,
        maxAllocatedStorage: 100,
        deletionProtection: false,
        backupRetentionPeriod: 1
      },
      scaling: {
        minCapacity: 1,
        maxCapacity: 3,
        targetCpuUtilization: 70
      },
      tailscale: {
        instanceType: "t3.nano"
      },
      monitoring: {
        logRetentionDays: 3,
        detailedMonitoring: false
      }
    },
    staging: {
      database: {
        instanceClass: "db.t3.small", 
        allocatedStorage: 50,
        maxAllocatedStorage: 200,
        deletionProtection: false,
        backupRetentionPeriod: 7
      },
      scaling: {
        minCapacity: 2,
        maxCapacity: 5,
        targetCpuUtilization: 60
      },
      tailscale: {
        instanceType: "t3.nano"
      },
      monitoring: {
        logRetentionDays: 7,
        detailedMonitoring: true
      }
    },
    prod: {
      database: {
        instanceClass: "db.t3.medium",
        allocatedStorage: 100,
        maxAllocatedStorage: 1000,
        deletionProtection: true,
        backupRetentionPeriod: 30
      },
      scaling: {
        minCapacity: 3,
        maxCapacity: 20,
        targetCpuUtilization: 50
      },
      tailscale: {
        instanceType: "t3.small"  // Slightly larger for prod
      },
      monitoring: {
        logRetentionDays: 30,
        detailedMonitoring: true
      }
    }
  };

  return {
    projectName: "pathfinder",
    environment: stack,
    enableTailscale,
    enableBetterStack,
    ...environmentConfigs[stack],
    // Load sensitive configuration
    tailscale: enableTailscale ? {
      apiKey: new pulumi.Config("tailscale").requireSecret("apiKey"),
      tailnet: new pulumi.Config("tailscale").require("tailnet"),
      authKey: new pulumi.Config("tailscale").requireSecret("authKey")
    } : undefined,
    betterStack: enableBetterStack ? {
      entrypoint: new pulumi.Config("betterstack").requireSecret("entrypoint"),
      sourceToken: new pulumi.Config("betterstack").requireSecret("sourceToken")
    } : undefined
  };
}
```

### Connecting to Database Through Tailscale

When Tailscale is enabled, you can connect directly to the private database:

```bash
# 1. Check if Tailscale is enabled and get connection info
pulumi stack output tailscale_enabled
pulumi stack output tailscale_database_host
pulumi stack output database_password --show-secrets

# 2. Connect to database using private IP (through Tailscale)
export DB_HOST=$(pulumi stack output tailscale_database_host)
export DB_PASSWORD=$(pulumi stack output database_password --show-secrets)

psql postgresql://pathfinder_admin:$DB_PASSWORD@$DB_HOST:5432/pathfinder?sslmode=require

# 3. Or use the pre-constructed connection URL
export DB_URL=$(pulumi stack output tailscale_database_url --show-secrets)
psql "$DB_URL"
```

### Complete Environment Setup Examples

**Development Environment Setup:**
```bash
# Development environment - minimal resources, optional features enabled
pulumi stack init dev
pulumi config set aws:region us-east-1

# Enable optional features for development
pulumi config set pathfinder:enableTailscale true      # Enable for dev database access
pulumi config set pathfinder:enableBetterStack true   # Enable for log monitoring
pulumi config set pathfinder:enableDetailedMonitoring false  # Keep minimal for dev

# Tailscale configuration (if enabled)
pulumi config set --secret tailscale:apiKey tskey-api-dev-xxxxxxxx
pulumi config set tailscale:tailnet pathfinder-dev.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-dev-xxxxxxxx

# Better Stack configuration (if enabled)
pulumi config set --secret betterstack:entrypoint https://in.logs.betterstack.com
pulumi config set --secret betterstack:sourceToken bt-dev-xxxxxxxx

pulumi up
```

**Production Environment Setup:**
```bash
# Production environment - larger resources, selective features
pulumi stack init prod
pulumi config set aws:region us-east-1

# Enable features for production
pulumi config set pathfinder:enableTailscale true            # Enable for admin access
pulumi config set pathfinder:enableBetterStack true         # Enable for comprehensive logging
pulumi config set pathfinder:enableDetailedMonitoring true  # Enable for production monitoring

# Separate Tailscale configuration for production
pulumi config set --secret tailscale:apiKey tskey-api-prod-xxxxxxxx
pulumi config set tailscale:tailnet pathfinder-prod.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-prod-xxxxxxxx

# Production Better Stack configuration
pulumi config set --secret betterstack:entrypoint https://in.logs.betterstack.com
pulumi config set --secret betterstack:sourceToken bt-prod-xxxxxxxx

pulumi up
```

**Minimal Environment (No Optional Features):**
```bash
# Minimal environment - only core infrastructure
pulumi stack init minimal
pulumi config set aws:region us-east-1
pulumi config set pathfinder:enableTailscale false
pulumi config set pathfinder:enableBetterStack false
pulumi config set pathfinder:enableDetailedMonitoring false

pulumi up  # Only deploys VPC, database, ECS, ALB - no Tailscale or Better Stack
```

### Environment Isolation Benefits

This approach provides:

- **Complete AWS Resource Isolation**: Each environment has separate VPCs, databases, ECS clusters
- **Independent Configuration**: Different instance sizes, retention periods, scaling policies per environment
- **Feature Control**: Enable/disable Tailscale, Better Stack, detailed monitoring per environment
- **Security Separation**: Different Tailscale tailnets, API keys, and access controls per environment
- **Cost Optimization**: Minimal resources in dev, appropriate sizing in prod
- **Easy Switching**: `pulumi stack select [env]` to switch between environments

---

## Stack Management and GitHub Actions CI/CD

### Local Stack Management

Pulumi stacks provide complete environment isolation. Each stack is a separate deployment with its own state, configuration, and AWS resources.

```bash
# List all stacks
pulumi stack ls

# Create new stacks
pulumi stack init dev
pulumi stack init staging  
pulumi stack init prod

# Switch between stacks
pulumi stack select dev      # Switch to dev environment
pulumi stack select prod     # Switch to prod environment

# Check current stack
pulumi stack                 # Shows current active stack

# View stack-specific configuration
pulumi config               # Shows config for current stack
pulumi config --stack dev   # Shows config for specific stack
```

### Complete Environment Setup Workflow

```bash
# === DEVELOPMENT ENVIRONMENT ===
pulumi stack init dev
pulumi stack select dev

# Basic configuration
pulumi config set aws:region us-east-1
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set pathfinder:enableDetailedMonitoring false

# Set secrets (if features enabled)
pulumi config set --secret tailscale:apiKey tskey-api-dev-xxxxxxxx
pulumi config set tailscale:tailnet pathfinder-dev.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-dev-xxxxxxxx
pulumi config set --secret betterstack:entrypoint https://in.logs.betterstack.com
pulumi config set --secret betterstack:sourceToken bt-dev-xxxxxxxx

# Deploy
pulumi up

# === PRODUCTION ENVIRONMENT ===
pulumi stack init prod
pulumi stack select prod

# Basic configuration  
pulumi config set aws:region us-east-1
pulumi config set pathfinder:enableTailscale true
pulumi config set pathfinder:enableBetterStack true
pulumi config set pathfinder:enableDetailedMonitoring true

# Set secrets (different values for prod)
pulumi config set --secret tailscale:apiKey tskey-api-prod-xxxxxxxx
pulumi config set tailscale:tailnet pathfinder-prod.ts.net
pulumi config set --secret tailscale:authKey tskey-auth-prod-xxxxxxxx
pulumi config set --secret betterstack:entrypoint https://in.logs.betterstack.com
pulumi config set --secret betterstack:sourceToken bt-prod-xxxxxxxx

# Deploy
pulumi up
```

### GitHub Actions CI/CD Setup

Create separate workflows for different environments that trigger based on branch patterns:

#### **`.github/workflows/deploy-dev.yml`** - Development Deployment
```yaml
name: Deploy to Development

on:
  push:
    branches: [main]  # Trigger on pushes to main branch
    paths: 
      - 'apps/infra/**'
      - 'apps/web/**'
  pull_request:
    branches: [main]
    paths:
      - 'apps/infra/**'
      - 'apps/web/**'

jobs:
  deploy-dev:
    runs-on: ubuntu-latest
    environment: development  # GitHub environment for dev secrets
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - name: Install Pulumi CLI
        uses: pulumi/actions@v4
        
      - name: Install dependencies
        run: |
          cd apps/infra
          npm install
          
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
          
             - name: Deploy to Development
         run: |
           cd apps/infra
           pulumi stack select dev  # Select dev stack (same token)
           pulumi up --yes
         env:
           PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}  # Same token for all stacks
           # Git metadata for builds
           GIT_BRANCH: ${{ github.ref_name }}
           GIT_COMMIT: ${{ github.sha }}
```

#### **`.github/workflows/deploy-prod.yml`** - Production Deployment
```yaml
name: Deploy to Production

on:
  push:
    branches: [release]  # Trigger on pushes to release branch
    paths:
      - 'apps/infra/**'
      - 'apps/web/**'

jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment: production  # GitHub environment for prod secrets
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - name: Install Pulumi CLI
        uses: pulumi/actions@v4
        
      - name: Install dependencies
        run: |
          cd apps/infra
          npm install
          
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID_PROD }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY_PROD }}
          aws-region: us-east-1
          
             - name: Deploy to Production
         run: |
           cd apps/infra
           pulumi stack select prod  # Select prod stack (same token)
           pulumi up --yes
         env:
           PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}  # Same token for all stacks
           # Git metadata for builds
           GIT_BRANCH: ${{ github.ref_name }}
           GIT_COMMIT: ${{ github.sha }}
```

### GitHub Repository Secrets Setup

You'll need to configure secrets in your GitHub repository settings:

#### **Repository Secrets** (shared across environments)
- `PULUMI_ACCESS_TOKEN` - Your Pulumi Cloud access token (works for all stacks)

#### **Environment-Specific Secrets**

**Development Environment:**
- `AWS_ACCESS_KEY_ID` - AWS access key for dev environment
- `AWS_SECRET_ACCESS_KEY` - AWS secret key for dev environment

**Production Environment:**
- `AWS_ACCESS_KEY_ID_PROD` - AWS access key for prod environment  
- `AWS_SECRET_ACCESS_KEY_PROD` - AWS secret key for prod environment

### How Pulumi Access Tokens Work

**Single Token, Multiple Stacks**: You use the same `PULUMI_ACCESS_TOKEN` for all environments. The token authenticates you to Pulumi Cloud, and then `pulumi stack select` determines which stack you're operating on.

```bash
# Same token, different stacks
export PULUMI_ACCESS_TOKEN=pul-xxxxxxxxxxxxxxxx

pulumi stack select dev      # Now operating on dev stack
pulumi up                    # Deploys to dev environment

pulumi stack select prod     # Now operating on prod stack  
pulumi up                    # Deploys to prod environment
```

**Security Isolation Comes From:**
- **Different AWS credentials** per environment (this is the main security boundary)
- **Different stack configurations** (each stack has its own config/secrets)
- **Stack-level permissions** (you can restrict who can access which stacks)

**Token Permissions**: Your Pulumi token gives you access to all stacks you have permissions for in your Pulumi organization. You don't need separate tokens per environment.

### Advanced Token Management (Optional)

For organizations requiring stricter separation, you can use:

**Different Pulumi Organizations:**
```bash
# Separate organizations for strict isolation
pulumi login --cloud-url https://app.pulumi.com/your-dev-org
pulumi stack select dev

pulumi login --cloud-url https://app.pulumi.com/your-prod-org  
pulumi stack select prod
```

**Service Account Tokens:**
```bash
# Different service accounts with limited permissions
PULUMI_ACCESS_TOKEN_DEV=pul-dev-xxxxxxxxxxxxxxxx    # Can only access dev stacks
PULUMI_ACCESS_TOKEN_PROD=pul-prod-xxxxxxxxxxxxxxxx  # Can only access prod stacks
```

**For most use cases, a single token with proper AWS credential separation is sufficient and simpler to manage.**

### Branch-Based Deployment Strategy

```
main branch    → Development environment (dev stack)
release branch → Production environment (prod stack)
feature/*      → No automatic deployment (manual only)
```

**Workflow:**
1. **Development**: Push to `main` → Automatically deploys to dev
2. **Production**: Merge `main` → `release` → Automatically deploys to prod
3. **Feature work**: Create feature branches → Deploy manually for testing

### Manual Deployment Commands

```bash
# Deploy to dev manually
git checkout main
pulumi stack select dev
pulumi up

# Deploy to prod manually  
git checkout release
pulumi stack select prod
pulumi up

# Quick stack switching for testing
pulumi stack select dev && pulumi preview    # Preview changes to dev
pulumi stack select prod && pulumi preview   # Preview changes to prod
```

### Stack State Management

Each stack maintains completely separate state:

```bash
# View stack outputs
pulumi stack select dev
pulumi stack output url                    # Dev application URL
pulumi stack output tailscale_database_host

pulumi stack select prod  
pulumi stack output url                    # Prod application URL
pulumi stack output tailscale_database_host
```

### Environment-Specific AWS Resources

Each stack creates completely isolated AWS resources:

**Development Stack (`dev`):**
- VPC: `pathfinder-vpc-dev-xxxxxxx`
- Database: `pathfinder-db-dev-xxxxxxx`
- ECS Cluster: `pathfinder-cluster-dev-xxxxxxx`
- Load Balancer: `pathfinder-lb-dev-xxxxxxx`

**Production Stack (`prod`):**
- VPC: `pathfinder-vpc-prod-xxxxxxx`
- Database: `pathfinder-db-prod-xxxxxxx`
- ECS Cluster: `pathfinder-cluster-prod-xxxxxxx`
- Load Balancer: `pathfinder-lb-prod-xxxxxxx`

### Troubleshooting Stack Issues

```bash
# If you get confused about which stack you're on
pulumi stack                           # Shows current stack
pulumi config get aws:region          # Shows current region
pulumi stack output environment       # Shows environment name

# If you accidentally deploy to wrong stack
pulumi stack select correct-stack
pulumi up                             # Deploy to correct stack
# The wrong stack resources remain unchanged

# Emergency: destroy wrong environment  
pulumi stack select wrong-stack
pulumi destroy --yes                  # CAREFUL: This deletes everything!
```

This setup gives you:
- **Complete isolation** between dev and prod
- **Automatic deployments** based on git branches
- **Manual override capability** for testing
- **Clear separation** of AWS credentials and resources
- **Rollback capability** through git branch management

