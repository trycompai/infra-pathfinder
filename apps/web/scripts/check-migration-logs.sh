#!/bin/bash

# Disable AWS CLI paging
export AWS_PAGER=""

echo "🔍 Checking recent migration logs..."

# Get the cluster and service names
CLUSTER_NAME=$(aws ecs list-clusters --query 'clusterArns[?contains(@, `pathfinder-cluster`)]' --output text | head -1 | awk -F'/' '{print $NF}')
echo "📋 Using cluster: $CLUSTER_NAME"

# Get the log group name
LOG_GROUP_NAME=$(aws logs describe-log-groups --log-group-name-prefix "pathfinder-logs" --query 'logGroups[0].logGroupName' --output text)
echo "📋 Using log group: $LOG_GROUP_NAME"

echo ""
echo "🔍 Recent tasks that ran migrations:"
echo "----------------------------------------"

# List recent tasks and check for migration-related logs
aws ecs list-tasks --cluster $CLUSTER_NAME --desired-status STOPPED --max-items 10 --query 'taskArns[]' --output text | while read task_arn; do
  if [ -n "$task_arn" ]; then
    TASK_ID=$(echo $task_arn | awk -F'/' '{print $NF}')
    LOG_STREAM_NAME="pathfinder/pathfinder-app/$TASK_ID"
    
    # Check if this task has migration-related logs
    if aws logs get-log-events \
      --log-group-name "$LOG_GROUP_NAME" \
      --log-stream-name "$LOG_STREAM_NAME" \
      --query 'events[?contains(message, `migration`) || contains(message, `migrate`)].{time:@.timestamp,message:@.message}' \
      --output text 2>/dev/null | grep -q .; then
      
      echo ""
      echo "📝 Task: $TASK_ID"
      echo "🕐 Migration logs:"
      
      aws logs get-log-events \
        --log-group-name "$LOG_GROUP_NAME" \
        --log-stream-name "$LOG_STREAM_NAME" \
        --query 'events[*].message' \
        --output text 2>/dev/null | grep -E "(migration|migrate|Starting database|Migration failed|Migrations completed)"
      
      echo "----------------------------------------"
    fi
  fi
done

echo ""
echo "💡 To see all logs for a specific task:"
echo "   aws logs get-log-events --log-group-name '$LOG_GROUP_NAME' --log-stream-name 'pathfinder/TASK_ID' --query 'events[*].message' --output text" 