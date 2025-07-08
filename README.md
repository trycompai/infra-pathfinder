# Pathfinder Monorepo

A modern monorepo powered by [Turborepo](https://turbo.build) and [Bun](https://bun.sh).

## What's inside?

This monorepo includes the following packages/apps:

### Apps

- `@pathfinder/web`: A [Next.js](https://nextjs.org/) app
- `infra`: [Pulumi](https://pulumi.com/) infrastructure as code for AWS deployment

### Packages

- (Add shared packages here as you grow)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- [Node.js](https://nodejs.org/) 18+
- AWS credentials configured (for infrastructure deployment)

### Development

To develop all apps and packages, run:

```bash
bun install
bun dev
```

### Build

To build all apps and packages, run:

```bash
bun build
```

### Infrastructure

Infrastructure commands are available from the root:

```bash
bun run infra:install    # Install infrastructure dependencies
bun run infra:preview    # Preview infrastructure changes
bun run infra:up         # Deploy infrastructure
bun run infra:destroy    # Tear down infrastructure
```

## CI/CD Deployment (Recommended for Apple Silicon users)

Local Docker builds on Apple Silicon can be slow due to x86 emulation. We've set up GitHub Actions for faster deployments:

- **Push to main** → Automatic deployment
- **Open a PR** → See infrastructure preview

See [CI/CD Setup Guide](docs/CI_SETUP.md) for configuration instructions.

## Remote Development

## Turborepo

This monorepo uses [Turborepo](https://turbo.build) for:

- **Smart caching** - Only rebuild what changed
- **Parallel execution** - Run tasks in parallel
- **Task dependencies** - Ensure tasks run in the right order
- **Remote caching** - Share cache artifacts across machines

Learn more about Turborepo in their [documentation](https://turbo.build/repo/docs).

## Useful Commands

- `bun dev` - Start all apps in development mode
- `bun build` - Build all apps for production
- `bun lint` - Lint all apps
- `bun type-check` - Type check all apps
