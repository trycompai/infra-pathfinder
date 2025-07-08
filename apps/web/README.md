# @pathfinder/web

This is the main [Next.js](https://nextjs.org) web application for Pathfinder.

## Getting Started

From the monorepo root:

```bash
bun dev
```

Or to run just this app:

```bash
cd apps/web
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Development

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Docker

This app includes a Dockerfile for containerized deployment. The infrastructure code in `/infra` uses this to deploy to AWS ECS.
