import type { AuthService } from "../auth.js";
import { calculateGenerationCreditCost } from "../pricing.js";
import { getImageTask } from "../router.js";

export function startAsyncReconciliation(authService: AuthService, intervalMs = 30_000): () => void {
  let running = false;

  async function reconcile(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const pending = await authService.listPendingUsageRecords(30);
      for (const record of pending) {
        if (record.provider !== "lingke" || !record.requestId) continue;
        try {
          const result = await getImageTask("lingke", record.requestId, record.model);
          if (result.status !== "completed" && result.status !== "failed") continue;
          const successful = result.status === "completed" && result.images.length > 0;
          await authService.finalizeAsyncUsage(record.userId, record.requestId, {
            status: successful ? "success" : "failed",
            imageCount: result.images.length,
            actualPointsCost: successful
              ? calculateGenerationCreditCost(
                  record.imageCount > 0 ? (record.pointsCost || 0) / record.imageCount : 0,
                  result.images.length
                )
              : 0,
            durationMs: result.durationMs,
            cost: result.cost,
            error: successful ? undefined : result.error || "异步任务未返回图片"
          });
        } catch (error) {
          console.error("Async generation reconciliation error", record.requestId, error);
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void reconcile(), intervalMs);
  timer.unref();
  void reconcile();
  return () => clearInterval(timer);
}
