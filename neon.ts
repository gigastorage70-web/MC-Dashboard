import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: false,
  buckets: {
    "mc-csv-uploads": {},
  },
  functions: {
    csvworker: {
      name: "MediaCore CSV Ingestion Worker",
      source: "functions/csvworker/index.ts",
      env: {
        ANALYTICS_ENGINE: "tinybird",
        TINYBIRD_API_URL: process.env.TINYBIRD_API_URL ?? "https://api.tinybird.co",
        TINYBIRD_TOKEN: {
          value: process.env.TINYBIRD_TOKEN,
          required: false,
          onUndefined: "skip",
        },
        WORKER_WEBHOOK_SECRET: {
          value: process.env.WORKER_WEBHOOK_SECRET,
          required: false,
          onUndefined: "skip",
        },
        S3_BUCKET: process.env.S3_BUCKET ?? "mc-csv-uploads",
      },
    },
  },
  branch: (branch) => {
    if (branch.isDefault) {
      return {};
    }
    if (!branch.exists) {
      return { ttl: "7d" };
    }
    return {};
  },
});
