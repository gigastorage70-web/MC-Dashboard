import { getEnv } from "../../lib/config/env";

export async function triggerWorkerWebhook(): Promise<void> {
  const env = getEnv();
  if (!env.WORKER_WEBHOOK_URL) return;
  try {
    await fetch(env.WORKER_WEBHOOK_URL, {
      method: "POST",
      headers: env.WORKER_WEBHOOK_SECRET
        ? { "x-worker-secret": env.WORKER_WEBHOOK_SECRET }
        : undefined,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Worker polls PostgreSQL SKIP LOCKED as durable fallback
  }
}
