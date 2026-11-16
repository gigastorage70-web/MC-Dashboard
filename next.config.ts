import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@clickhouse/client", "bcryptjs", "node:sqlite"],
  outputFileTracingIncludes: {
    "/api/**": ["./database/**/*"],
  },
};

export default nextConfig;
