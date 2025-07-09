#!/bin/bash

# Disable AWS CLI paging
export AWS_PAGER=""

echo "🧪 Testing Better Stack log forwarding..."

# Get log group names
LOG_GROUP_NAME=$(aws logs describe-log-groups --log-group-name-prefix "pathfinder-logs" --query 'logGroups[0].logGroupName' --output text)
RDS_LOG_GROUP_NAME=$(aws logs describe-log-groups --log-group-name-prefix "/aws/rds/instance/pathfinder-db" --query 'logGroups[0].logGroupName' --output text)

echo "📋 Found log groups:"
echo "   ECS: $LOG_GROUP_NAME"
echo "   RDS: $RDS_LOG_GROUP_NAME"

# Check subscription filters
echo ""
echo "🔍 Checking subscription filters..."
echo "=== ECS Log Group ==="
aws logs describe-subscription-filters --log-group-name "$LOG_GROUP_NAME" --query 'subscriptionFilters[*].[filterName,destinationArn]' --output table 2>/dev/null || echo "No filters found"

echo ""
echo "=== RDS Log Group ==="
aws logs describe-subscription-filters --log-group-name "$RDS_LOG_GROUP_NAME" --query 'subscriptionFilters[*].[filterName,destinationArn]' --output table 2>/dev/null || echo "No filters found"

echo ""
echo "=== Better Stack Lambda Function ==="
aws logs describe-subscription-filters --log-group-name "/aws/lambda/logtail-aws-lambda" --query 'subscriptionFilters[*].[filterName,destinationArn]' --output table 2>/dev/null || echo "No filters found"

# Test log forwarding by creating a test log event
echo ""
echo "📝 Creating test log event..."
aws logs put-log-events \
  --log-group-name "$LOG_GROUP_NAME" \
  --log-stream-name "test-stream-$(date +%s)" \
  --log-events timestamp=$(date +%s000),message="🧪 Better Stack test log event - $(date)" \
  --region us-east-1

echo ""
echo "✅ Test log event created!"
echo "💡 Check your Better Stack dashboard to see if the log appears"
echo "🔗 Better Stack URL: https://logs.betterstack.com" 