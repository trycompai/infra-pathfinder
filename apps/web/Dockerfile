# Stage 1: Dependencies
FROM oven/bun:1.2.18-alpine AS deps
WORKDIR /app

# Copy only package files first (for better caching)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Stage 2: Builder
FROM oven/bun:1.2.18-alpine AS builder
WORKDIR /app

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN bun run build

# Stage 3: Runner
FROM oven/bun:1.2.18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy only necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# Next.js standalone build runs with node by default
CMD ["bun", "server.js"]

