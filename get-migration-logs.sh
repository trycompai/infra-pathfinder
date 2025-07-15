#!/bin/bash

LOG_GROUP="pathfinder-logs-a5c296d"
REGION="us-east-1"

echo "Getting recent log streams for migration..."
aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --order-by LastEventTime \
  --descending \
  --region "$REGION" \
  --max-items 10 \
  --output table \
  --query 'logStreams[].{StreamName:logStreamName,LastEvent:lastEventTime}'

echo ""
echo "Getting recent migration task logs..."
MIGRATION_STREAM=$(aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --order-by LastEventTime \
  --descending \
  --region "$REGION" \
  --max-items 10 \
  --query 'logStreams[?contains(logStreamName, `migration-task`)].logStreamName' \
  --output text | head -1)

if [ -n "$MIGRATION_STREAM" ]; then
  echo "Found migration stream: $MIGRATION_STREAM"
  echo "Migration logs:"
  echo "=================================="
  aws logs get-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "$MIGRATION_STREAM" \
    --region "$REGION" \
    --query 'events[].message' \
    --output text
else
  echo "No migration log stream found"
fi 