import { getEnv } from "../../lib/config/env";

export async function triggerWorkerWebhook(): Promise<boolean> {
  const env = getEnv();
  if (!env.WORKER_WEBHOOK_URL) {
    console.warn("[worker-trigger] WORKER_WEBHOOK_URL is empty; upload stays QUEUED.");
    return false;
  }
  try {
    const res = await fetch(env.WORKER_WEBHOOK_URL, {
      method: "POST",
      headers: env.WORKER_WEBHOOK_SECRET
        ? { "x-worker-secret": env.WORKER_WEBHOOK_SECRET }
        : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(
        `[worker-trigger] Webhook ${env.WORKER_WEBHOOK_URL} returned HTTP ${res.status}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[worker-trigger] Webhook call failed: ${err instanceof Error ? err.message : "unknown"}`
    );
    return false;
  }
}
