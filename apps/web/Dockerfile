# Stage 1: Dependencies
FROM oven/bun:1.2.18-alpine AS deps
WORKDIR /app

# Copy only package files first (for better caching)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Stage 2: Builder
FROM oven/bun:1.2.18-alpine AS builder
WORKDIR /app

# Install AWS RDS certificates for proper SSL verification
RUN apk add --no-cache curl && \
    curl -o /tmp/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem && \
    mkdir -p /usr/local/share/ca-certificates && \
    cp /tmp/global-bundle.pem /usr/local/share/ca-certificates/rds-ca-bundle.crt && \
    update-ca-certificates

# Accept database connection parameters as build arguments
ARG PGHOST
ARG PGPORT
ARG PGDATABASE
ARG PGUSER
ARG PGPASSWORD
ARG PGSSLMODE

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application with properly constructed DATABASE_URL (SSL with proper certs)
RUN export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=require" && \
    export NODE_ENV="production" && \
    echo "Building with DATABASE_URL: postgresql://${PGUSER}:***@${PGHOST}:${PGPORT}/${PGDATABASE}" && \
    echo "🧪 Testing database connection before build..." && \
    node test-build-connection.js && \
    echo "🚀 Starting Next.js build..." && \
    bun run build

# Stage 3: Runner
FROM oven/bun:1.2.18-alpine AS runner
WORKDIR /app

# Install AWS RDS certificates for runtime SSL connections
RUN apk add --no-cache curl && \
    curl -o /tmp/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem && \
    mkdir -p /usr/local/share/ca-certificates && \
    cp /tmp/global-bundle.pem /usr/local/share/ca-certificates/rds-ca-bundle.crt && \
    update-ca-certificates && \
    rm -rf /tmp/global-bundle.pem

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Cache bust to force rebuild
LABEL build_date="2024-12-08-15:08"

# Copy only necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy migration files and scripts for database migrations
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "server.js"]

