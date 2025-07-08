# CI/CD Setup Guide

This guide explains how to set up GitHub Actions for automated deployments.

## Required GitHub Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

1. **`AWS_ACCESS_KEY_ID`** - Your AWS access key
2. **`AWS_SECRET_ACCESS_KEY`** - Your AWS secret key
3. **`PULUMI_ACCESS_TOKEN`** - Your Pulumi access token

## Getting the Secrets

### AWS Credentials

```bash
# Option 1: Create a new IAM user for CI/CD
aws iam create-user --user-name github-actions-deploy
aws iam attach-user-policy --user-name github-actions-deploy --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam create-access-key --user-name github-actions-deploy

# Option 2: Use your existing credentials (less secure)
cat ~/.aws/credentials
```

### Pulumi Access Token

```bash
# Get your Pulumi token
pulumi login
# Then go to https://app.pulumi.com/account/tokens to create a new token
```

## How It Works

### On Push to Main (`deploy.yml`)

1. Builds your Next.js app in GitHub's x86 environment (no emulation!)
2. Pushes Docker image to ECR
3. Deploys infrastructure with Pulumi
4. Build takes ~2-3 minutes vs 10+ minutes on Apple Silicon

### On Pull Request (`preview.yml`)

1. Shows what infrastructure changes would happen
2. Comments on the PR with the preview
3. Helps catch issues before merging

## Benefits

- **10x faster builds** - No ARM→x86 emulation
- **Automated deployments** - Push to main = deploy
- **PR previews** - See infrastructure changes before merging
- **No local Docker/AWS setup needed** - Great for team members

## Testing Locally vs CI

- **Local builds (Apple Silicon)**: Slow due to emulation, good for testing
- **CI builds (GitHub Actions)**: Fast native x86 builds, production deployments

## Workflow

1. Make changes locally
2. Push to a feature branch
3. Open PR → See infrastructure preview
4. Merge to main → Automatic deployment

## Monitoring Deployments

- Check Actions tab in GitHub
- View logs in real-time
- Get notified on failures
