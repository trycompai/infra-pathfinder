
// ==========================================
// COMMON INFRASTRUCTURE UTILITIES
// ==========================================

/**
 * Generate deterministic image tag for container deployments
 * Format: environment-commit-timestamp
 */
export function generateImageTag(environment: string, gitCommit: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const shortCommit = gitCommit.substring(0, 7);
  return `${environment}-${shortCommit}-${timestamp}`;
}

/**
 * Get git commit hash from environment or return default
 */
export function getGitCommit(): string {
  return process.env.GIT_COMMIT?.substring(0, 7) || "unknown";
}

/**
 * Get git branch from environment or return default
 */
export function getGitBranch(): string {
  return process.env.GIT_BRANCH || "unknown";
}

/**
 * Create consistent resource naming
 */
export function createResourceName(prefix: string, environment: string, suffix?: string): string {
  const parts = [prefix, environment];
  if (suffix) {
    parts.push(suffix);
  }
  return parts.join('-');
}

/**
 * Validate environment configuration
 */
export function validateEnvironment(environment: string): void {
  const validEnvironments = ['dev', 'staging', 'prod'];
  if (!validEnvironments.includes(environment)) {
    throw new Error(`Invalid environment: ${environment}. Must be one of: ${validEnvironments.join(', ')}`);
  }
}

/**
 * Create common tags for all resources
 */
export function createCommonTags(
  project: string, 
  environment: string, 
  additionalTags: Record<string, string> = {}
): Record<string, string> {
  return {
    Project: project,
    Environment: environment,
    ManagedBy: "pulumi",
    Owner: "platform-team",
    CreatedDate: new Date().toISOString().split('T')[0],
    GitBranch: getGitBranch(),
    GitCommit: getGitCommit(),
    ...additionalTags
  };
} 