import type { NextConfig } from "next";

// Import env here to validate during build time
import "./src/env";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  // Add the packages in transpilePackages for standalone mode
  transpilePackages: ["@t3-oss/env-nextjs", "@t3-oss/env-core"],
  // Explicitly define environment variables for standalone mode
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_DEBUG_ENDPOINTS: process.env.ENABLE_DEBUG_ENDPOINTS,
  },
};

export default nextConfig;
