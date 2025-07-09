# Todo App Setup Guide

This is a simple Todo app built with Next.js, Drizzle ORM, and PostgreSQL to test your AWS RDS database connection.

## Features

- ✅ Create new todos
- ✅ Mark todos as complete/incomplete
- ✅ Delete todos
- ✅ Real-time database connection status
- ✅ Full CRUD operations

## Setup Instructions

### 1. Configure Database Connection

Update the `.env.local` file with your actual AWS RDS database URL:

```bash
DATABASE_URL=postgresql://pathfinder_admin:YOUR_ACTUAL_PASSWORD@YOUR_RDS_ENDPOINT.region.rds.amazonaws.com:5432/pathfinder
```

You can get this URL from your Pulumi stack outputs:

```bash
cd ../infra
pulumi stack output dbConnectionString --show-secrets
```

### 2. Apply Database Schema

Push the schema to your database:

```bash
bun db:push
```

This will create the `todos` table in your PostgreSQL database.

### 3. Run the Development Server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to see your todo app.

## Docker Deployment

The existing Dockerfiles work perfectly with the new database setup. When deploying:

1. **Local Docker Testing:**

   ```bash
   docker build -t pathfinder-web .
   docker run -p 3000:3000 -e DATABASE_URL="your-connection-string" pathfinder-web
   ```

2. **ECS Deployment:**
   The DATABASE_URL is already configured in your Pulumi infrastructure code and will be automatically injected into the container.

## Database Commands

- `bun db:generate` - Generate migration files from schema changes
- `bun db:push` - Push schema changes directly to database (dev)
- `bun db:migrate` - Apply migrations (production)
- `bun db:studio` - Open Drizzle Studio to browse your database

## Troubleshooting

1. **"Failed to load todos. Is your database connected?"**

   - Check your DATABASE_URL in `.env.local`
   - Ensure your RDS instance is running
   - Verify security group allows connections

2. **Connection timeouts**
   - Check if you're on the correct network/VPN
   - Verify RDS security group rules
   - Ensure the database is publicly accessible (for local development)

## API Endpoints

- `GET /api/todos` - List all todos
- `POST /api/todos` - Create a new todo
- `PATCH /api/todos/[id]` - Update a todo
- `DELETE /api/todos/[id]` - Delete a todo
