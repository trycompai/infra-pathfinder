#!/bin/bash
set -euo pipefail

echo "=== Running database migrations ==="

# Start the migration task
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER_NAME" \
  --task-definition pathfinder-migration \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID],securityGroups=[$SECURITY_GROUP_ID],assignPublicIp=ENABLED}" \
  --launch-type FARGATE \
  --query 'tasks[0].taskArn' \
  --output text)

echo "Migration task started: $TASK_ARN"

# Wait for the task to complete
aws ecs wait tasks-stopped --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN"

# Check if migration succeeded
EXIT_CODE=$(aws ecs describe-tasks \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

if [ "$EXIT_CODE" != "0" ]; then
  echo "❌ Migration failed with exit code: $EXIT_CODE"
  exit 1
fi

echo "✅ Migrations completed successfully!" 