#!/bin/bash

# Disable AWS CLI paging
export AWS_PAGER=""

echo "🔧 Setting up RDS log forwarding to Better Stack..."

# Get the RDS log group name from Pulumi outputs
RDS_LOG_GROUP=$(cd ../../apps/infra && pulumi stack output rdsLogGroupName)
LAMBDA_ARN=$(cd ../../apps/infra && pulumi stack output betterStackLambdaArn)

echo "📋 Configuration:"
echo "   RDS Log Group: $RDS_LOG_GROUP"
echo "   Lambda ARN: $LAMBDA_ARN"

# Check if RDS log group exists
echo ""
echo "🔍 Checking if RDS log group exists..."
if aws logs describe-log-groups --log-group-name-prefix "$RDS_LOG_GROUP" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$RDS_LOG_GROUP"; then
    echo "✅ RDS log group exists!"
    
    # Check if subscription filter already exists
    echo "🔍 Checking for existing subscription filter..."
    if aws logs describe-subscription-filters --log-group-name "$RDS_LOG_GROUP" --query 'subscriptionFilters[?filterName==`logtail-aws-lambda-rds-filter`]' --output text | grep -q .; then
        echo "✅ RDS log forwarding already set up!"
    else
        echo "📝 Creating RDS log subscription filter..."
        
        # Create the subscription filter
        aws logs put-subscription-filter \
            --log-group-name "$RDS_LOG_GROUP" \
            --filter-name "logtail-aws-lambda-rds-filter" \
            --filter-pattern "" \
            --destination-arn "$LAMBDA_ARN"
        
        # Grant permission for CloudWatch Logs to invoke the Lambda
        echo "🔑 Adding Lambda permission for RDS logs..."
        ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
        REGION=$(aws configure get region || echo "us-east-1")
        
        aws lambda add-permission \
            --function-name "logtail-aws-lambda" \
            --statement-id "AllowExecutionFromCloudWatchLogsRDS" \
            --action "lambda:InvokeFunction" \
            --principal "logs.amazonaws.com" \
            --source-arn "arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:$RDS_LOG_GROUP:*" \
            2>/dev/null || echo "⚠️  Permission may already exist"
        
        echo "✅ RDS log forwarding set up successfully!"
    fi
else
    echo "❌ RDS log group doesn't exist yet."
    echo "💡 This is normal if:"
    echo "   - RDS instance was just created"
    echo "   - Database hasn't received any connections yet" 
    echo "   - PostgreSQL logging isn't enabled"
    echo ""
    echo "🔄 Try running this script again in a few minutes after the database is active."
fi

echo ""
echo "🧪 Testing current Better Stack setup..."
./test-better-stack.sh 