# syntax=docker/dockerfile:1

# ==========================================
# BASE STAGE - Common setup for all stages
# ==========================================
FROM oven/bun:1 AS base
WORKDIR /app

# ==========================================
# DEPS STAGE - Install production dependencies
# ==========================================
FROM base AS deps
# Copy package files for dependency installation
COPY package.json bun.lockb* ./
# Install production dependencies only
RUN bun install --frozen-lockfile --production

# ==========================================
# BUILD STAGE - Build the Next.js application
# ==========================================
FROM base AS builder
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
# Install all dependencies (including devDependencies needed for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN bunx prisma generate

# Build arguments for compile-time environment variables
ARG DATABASE_URL
ARG NODE_ENV=production

# Set environment variables for build
ENV DATABASE_URL=$DATABASE_URL
ENV NODE_ENV=$NODE_ENV
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN bun run build

# ==========================================
# RUNNER STAGE - Production runtime
# ==========================================
FROM base AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy necessary files from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["bun", "server.js"]

