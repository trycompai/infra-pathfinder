# Stage 1: Dependencies
FROM public.ecr.aws/lambda/nodejs:18-x86_64 AS deps
WORKDIR /app

# Install unzip (required for Bun installer) and Bun
RUN yum update -y && yum install -y unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Copy only package files first (for better caching)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Stage 2: Builder
FROM public.ecr.aws/lambda/nodejs:18-x86_64 AS builder
WORKDIR /app

# Install unzip (required for Bun installer) and Bun
RUN yum update -y && yum install -y unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Accept DATABASE_URL as build argument
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN bun run build

# Stage 3: Runner
FROM public.ecr.aws/lambda/nodejs:18-x86_64 AS runner
WORKDIR /app

# Install unzip (required for Bun installer) and Bun
RUN yum update -y && yum install -y unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

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

