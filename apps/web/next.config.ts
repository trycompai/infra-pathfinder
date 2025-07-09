import type { NextConfig } from "next";

// Import env here to validate during build time
import "./src/env";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  // Add the packages in transpilePackages for standalone mode
  transpilePackages: ["@t3-oss/env-nextjs", "@t3-oss/env-core"],
};

export default nextConfig;
