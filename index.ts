import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

// Get current AWS region and account ID
const current = aws.getCallerIdentity({});
const region = aws.getRegion({});

// Create VPC with public subnets (for publicly accessible RDS)
const vpc = new awsx.ec2.Vpc("pathfinder-vpc", {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
    enableDnsHostnames: true,
    enableDnsSupport: true,
});

// Create ECR repository
const ecrRepo = new awsx.ecr.Repository("pathfinder-repo", {
    forceDelete: true,
});

// Generate a random password for RDS
const dbPassword = new aws.secretsmanager.Secret("pathfinder-db-password");
const randomPassword = new random.RandomPassword("db-password", {
    length: 32,
    special: true,
});

const dbPasswordValue = new aws.secretsmanager.SecretVersion("pathfinder-db-password-value", {
    secretId: dbPassword.id,
    secretString: randomPassword.result,
});

// Create RDS subnet group using public subnets
const dbSubnetGroup = new aws.rds.SubnetGroup("pathfinder-db-subnet-group", {
    subnetIds: vpc.publicSubnetIds,
    tags: {
        Name: "Pathfinder DB subnet group",
    },
});

// Security group for RDS - allow public access
const dbSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-db-sg", {
    vpcId: vpc.vpcId,
    description: "Security group for Pathfinder RDS database",
    ingress: [
        {
            protocol: "tcp",
            fromPort: 5432,
            toPort: 5432,
            cidrBlocks: ["0.0.0.0/0"], // Allow public access
            description: "PostgreSQL access from anywhere",
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

// Create publicly accessible RDS instance
const db = new aws.rds.Instance("pathfinder-db", {
    identifier: "pathfinder-db",
    allocatedStorage: 20,
    storageType: "gp3",
    engine: "postgres",
    engineVersion: "15.7",
    instanceClass: "db.t3.micro",
    dbName: "pathfinder",
    username: "pathfinder_admin",
    password: randomPassword.result,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    dbSubnetGroupName: dbSubnetGroup.name,
    publiclyAccessible: true, // Make database publicly accessible
    skipFinalSnapshot: true,
    storageEncrypted: true,
    
    // Enable logging
    enabledCloudwatchLogsExports: ["postgresql"],
    
    // Performance insights
    performanceInsightsEnabled: true,
    performanceInsightsRetentionPeriod: 7,
    
    backupRetentionPeriod: 7,
    backupWindow: "07:00-09:00",
    maintenanceWindow: "sun:09:00-sun:10:00",
    
    tags: {
        Name: "Pathfinder Database",
        Environment: "production",
    },
});

// Create ECS cluster
const cluster = new aws.ecs.Cluster("pathfinder-cluster", {
    name: "pathfinder-cluster",
    settings: [
        {
            name: "containerInsights",
            value: "enabled",
        },
    ],
});

// Create CloudWatch Log Group
const logGroup = new aws.cloudwatch.LogGroup("pathfinder-logs", {
    name: "pathfinder-logs",
    retentionInDays: 7,
});

// Security group for ECS tasks
const ecsSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-ecs-sg", {
    vpcId: vpc.vpcId,
    description: "Security group for Pathfinder ECS tasks",
    ingress: [
        {
            protocol: "tcp",
            fromPort: 3000,
            toPort: 3000,
            cidrBlocks: ["0.0.0.0/0"],
            description: "HTTP access",
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

// IAM role for ECS tasks
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
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

// Task role for ECS tasks
const taskRole = new aws.iam.Role("pathfinder-task-role", {
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

// Create Application Load Balancer using raw AWS resources
const albSecurityGroup = new aws.ec2.SecurityGroup("pathfinder-alb-sg", {
    vpcId: vpc.vpcId,
    description: "Security group for Pathfinder ALB",
    ingress: [
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
            description: "HTTP access",
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

const alb = new aws.lb.LoadBalancer("pathfinder-lb", {
    name: "pathfinder-lb",
    loadBalancerType: "application",
    subnets: vpc.publicSubnetIds,
    securityGroups: [albSecurityGroup.id],
    enableDeletionProtection: false,
});

const targetGroup = new aws.lb.TargetGroup("pathfinder-tg", {
    name: "pathfinder-tg",
    port: 3000,
    protocol: "HTTP",
    vpcId: vpc.vpcId,
    targetType: "ip",
    healthCheck: {
        enabled: true,
        path: "/",
        protocol: "HTTP",
        matcher: "200",
    },
});

const listener = new aws.lb.Listener("pathfinder-listener", {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [
        {
            type: "fixed-response",
            fixedResponse: {
                contentType: "text/plain",
                messageBody: "Pathfinder is starting...",
                statusCode: "200",
            },
        },
    ],
});

// Build database connection string
const connectionString = pulumi.interpolate`postgresql://${db.username}:${randomPassword.result}@${db.endpoint}/${db.dbName}?sslmode=require`;

// Export important values
export const vpcId = vpc.vpcId;
export const ecrRepositoryUrl = ecrRepo.url;
export const dbEndpoint = db.endpoint;
export const dbConnectionString = connectionString;
export const albUrl = pulumi.interpolate`http://${alb.dnsName}`;
export const logGroupName = logGroup.name;
export const clusterName = cluster.name;

// Export deployment instructions
export const deploymentInstructions = pulumi.interpolate`
🚀 Simplified Pathfinder Infrastructure Deployed!

📊 Key Resources:
• Database: ${db.endpoint} (publicly accessible)
• Load Balancer: http://${alb.dnsName}
• ECR Repository: ${ecrRepo.url}
• ECS Cluster: ${cluster.name}

🔧 Next Steps for 2-Stage Deployment:

1️⃣ STAGE 1 - Run Migrations:
   docker build -f Dockerfile.migrations -t pathfinder-migrations .
   docker tag pathfinder-migrations ${ecrRepo.url}:migrations-latest
   docker push ${ecrRepo.url}:migrations-latest
   
   # Run migrations locally first (must succeed):
   docker run --rm -e DATABASE_URL="${connectionString}" ${ecrRepo.url}:migrations-latest

2️⃣ STAGE 2 - Deploy App (only if migrations succeed):
   docker build --build-arg DATABASE_URL="${connectionString}" -t pathfinder-app .
   docker tag pathfinder-app ${ecrRepo.url}:app-latest  
   docker push ${ecrRepo.url}:app-latest
   
   # Deploy to ECS using the pushed image

💾 Database: PostgreSQL 15.7 on db.t3.micro (publicly accessible)
🔐 Connection: Use the dbConnectionString output for database access
📝 Logs: Available in CloudWatch Log Group: ${logGroup.name}
`;
