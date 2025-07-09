# Pathfinder Web App

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Database Migrations

We follow **Option 3** from the [Drizzle migrations guide](https://orm.drizzle.team/docs/migrations): "Codebase first with drizzle-kit generate + drizzle-kit migrate"

### Development Workflow:

1. **Modify schema**: Update `src/db/schema.ts`
2. **Generate migration**: `bun run db:generate`
3. **Apply migration**: `bun run db:migrate`
4. **Verify changes**: `bun run db:studio`

### Production Deployment:

Migrations are automatically applied during deployment via GitHub Actions using the CLI approach for maximum reliability.

### Available Scripts:

- `db:generate` - Generate migration files from schema changes
- `db:migrate` - Apply pending migrations to database
- `db:push` - Push schema directly (development only)
- `db:studio` - Open Drizzle Studio GUI
- `db:check` - Validate migration files
- `db:drop` - Drop migration files (use with caution)
- `db:migrate:runtime` - Legacy runtime migration approach

### Environment Variables:

Environment variables are validated at build time using [t3-oss/env-nextjs](https://env.t3.gg/docs/nextjs):

- `DATABASE_URL` - PostgreSQL connection string (required)
- `NODE_ENV` - Environment mode

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
