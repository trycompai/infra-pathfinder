import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { CommonConfig, NetworkOutputs } from "../types";

export function createDatabase(config: CommonConfig, network: NetworkOutputs) {
  const { commonTags } = config;

  // Generate a secure random password for the database
  const dbPassword = new random.RandomPassword("pathfinder-db-password", {
    length: 32,
    special: true,
    overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
  });

  // Create AWS Secret for database credentials (will be populated after RDS instance is created)
  const dbSecret = new aws.secretsmanager.Secret("pathfinder-db-secret", {
    name: "pathfinder/database/master-password",
    description: "Complete DATABASE_URL for Pathfinder PostgreSQL database",
    tags: {
      ...commonTags,
      Name: "pathfinder-db-secret",
      Type: "secret",
    },
  });

  // Database subnet group in private subnets only
  const dbSubnetGroup = new aws.rds.SubnetGroup("pathfinder-db-subnet-group", {
    subnetIds: network.privateSubnetIds,
    description: "Subnet group for private database access",
    tags: {
      ...commonTags,
      Name: "pathfinder-db-subnet-group",
      Type: "db-subnet-group",
    },
  });

  // Enhanced monitoring role for RDS
  const enhancedMonitoringRole = new aws.iam.Role("pathfinder-rds-monitoring-role", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "monitoring.rds.amazonaws.com",
          },
        },
      ],
    }),
    tags: {
      ...commonTags,
      Name: "pathfinder-rds-monitoring-role",
      Type: "iam-role",
    },
  });

  const enhancedMonitoringRoleAttachment = new aws.iam.RolePolicyAttachment("pathfinder-rds-monitoring-policy", {
    role: enhancedMonitoringRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole",
  });

  // DB parameter group for PostgreSQL optimization
  const dbParameterGroup = new aws.rds.ParameterGroup("pathfinder-db-params", {
    family: "postgres15",
    description: "Custom parameter group for Pathfinder PostgreSQL database",
    parameters: [
      {
        name: "shared_preload_libraries",
        value: "pg_stat_statements",
      },
      {
        name: "log_statement",
        value: "all",
      },
      {
        name: "log_min_duration_statement",
        value: "1000",
      },
    ],
    tags: {
      ...commonTags,
      Name: "pathfinder-db-params",
      Type: "db-parameter-group",
    },
  });

  // Primary RDS instance in private subnets
  const dbInstance = new aws.rds.Instance("pathfinder-database", {
    engine: "postgres",
    engineVersion: "15.8",
    instanceClass: config.dbInstanceClass || "db.t3.micro",
    allocatedStorage: config.dbAllocatedStorage || 20,
    maxAllocatedStorage: config.dbMaxAllocatedStorage || 100,
    storageType: "gp3",
    storageEncrypted: true,
    
    dbName: "pathfinder",
    username: "pathfinder_admin",
    password: dbPassword.result,
    
    vpcSecurityGroupIds: [network.securityGroups.database],
    dbSubnetGroupName: dbSubnetGroup.name,
    parameterGroupName: dbParameterGroup.name,
    
    publiclyAccessible: false, // Critical: no public access
    multiAz: config.environment === "prod",
    
    backupRetentionPeriod: config.dbBackupRetentionPeriod || 7,
    backupWindow: "03:00-04:00",
    maintenanceWindow: "Sun:04:00-Sun:05:00",
    
    deletionProtection: config.dbDeletionProtection || false,
    skipFinalSnapshot: !config.dbDeletionProtection,
    finalSnapshotIdentifier: config.dbDeletionProtection ? "pathfinder-final-snapshot" : undefined,
    
    monitoringInterval: 60,
    monitoringRoleArn: enhancedMonitoringRole.arn,
    enabledCloudwatchLogsExports: ["postgresql"],
    
    performanceInsightsEnabled: true,
    performanceInsightsRetentionPeriod: 7,
    
    tags: {
      ...commonTags,
      Name: "pathfinder-database",
      Type: "rds-instance",
    },
  });

  // Store the complete DATABASE_URL in the secret after instance is created
  const dbSecretVersion = new aws.secretsmanager.SecretVersion("pathfinder-db-secret-version", {
    secretId: dbSecret.id,
    secretString: dbInstance.endpoint.apply(endpoint => 
      `postgresql://pathfinder_admin:${dbPassword.result}@${endpoint}:5432/pathfinder?sslmode=require`
    ),
  });

  // Read replica for production environment
  const readReplica = config.environment === "prod" ? new aws.rds.Instance("pathfinder-db-read-replica", {
    replicateSourceDb: dbInstance.id,
    instanceClass: config.dbInstanceClass || "db.t3.micro",
    publiclyAccessible: false,
    
    monitoringInterval: 60,
    monitoringRoleArn: enhancedMonitoringRole.arn,
    
    tags: {
      ...commonTags,
      Name: "pathfinder-db-read-replica",
      Type: "rds-read-replica",
    },
  }) : undefined;

  // CloudWatch log group for database logs
  const dbLogGroup = new aws.cloudwatch.LogGroup("pathfinder-db-logs", {
    name: pulumi.interpolate`/aws/rds/instance/${dbInstance.id}/postgresql`,
    retentionInDays: config.logRetentionDays || 14,
    tags: {
      ...commonTags,
      Name: "pathfinder-db-logs",
      Type: "log-group",
    },
  });

  // Database connection alarms
  const dbConnectionAlarm = new aws.cloudwatch.MetricAlarm("pathfinder-db-connection-alarm", {
    name: "pathfinder-database-high-connections",
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 2,
    metricName: "DatabaseConnections",
    namespace: "AWS/RDS",
    period: 300,
    statistic: "Average",
    threshold: 40,
    treatMissingData: "notBreaching",
    dimensions: {
      DBInstanceIdentifier: dbInstance.id,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-db-connection-alarm",
      Type: "cloudwatch-alarm",
    },
  });

  const dbCpuAlarm = new aws.cloudwatch.MetricAlarm("pathfinder-db-cpu-alarm", {
    name: "pathfinder-database-high-cpu",
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 3,
    metricName: "CPUUtilization",
    namespace: "AWS/RDS",
    period: 300,
    statistic: "Average",
    threshold: 80,
    treatMissingData: "notBreaching",
    dimensions: {
      DBInstanceIdentifier: dbInstance.id,
    },
    tags: {
      ...commonTags,
      Name: "pathfinder-db-cpu-alarm",
      Type: "cloudwatch-alarm",
    },
  });

  // Return database outputs
  return {
    instanceId: dbInstance.id,
    endpoint: dbInstance.endpoint,
    port: dbInstance.port,
    dbName: dbInstance.dbName,
    username: dbInstance.username,
    password: dbPassword.result,
    secretArn: dbSecret.arn,
    secretId: dbSecret.id,
    connectionString: pulumi.interpolate`postgresql://${dbInstance.username}:${dbPassword.result}@${dbInstance.endpoint}/${dbInstance.dbName}?sslmode=require`,
    readReplicaEndpoint: readReplica?.endpoint,
    logGroupName: dbLogGroup.name,
    connectionAlarmArn: dbConnectionAlarm.arn,
    cpuAlarmArn: dbCpuAlarm.arn,
  };
} 