import { Router, type RequestHandler } from "express";
import type { AppDatabase } from "../db/database.js";
import { AuthError } from "../auth.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { sendAuthError } from "../utils/express.js";
import { createPromptOptimizerService } from "../services/prompt-optimizer.js";

type JsonRecord = Record<string, unknown>;

export function createPromptOptimizerRouter(options: {
  database: AppDatabase;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}): Router {
  const router = Router();
  const { database, requireAuth, requireAdmin } = options;
  const service = createPromptOptimizerService(database);
  const lastOptimizeAt = new Map<string, number>();

  router.get("/api/admin/prompt-optimizer", requireAuth, requireAdmin, async (_request, response) => {
    try {
      return response.json({ settings: await service.getAdminSettings() });
    } catch (error) {
      return sendAuthError(response, error, "读取提示词优化配置失败");
    }
  });

  router.patch("/api/admin/prompt-optimizer", requireAuth, requireAdmin, async (request, response) => {
    try {
      return response.json({ settings: await service.update(asRecord(request.body)) });
    } catch (error) {
      return sendAuthError(response, error, "更新提示词优化配置失败");
    }
  });

  router.post("/api/admin/prompt-optimizer/test", requireAuth, requireAdmin, async (_request, response) => {
    try {
      return response.json(await service.test());
    } catch (error) {
      return sendAuthError(response, error, "提示词优化 API 测试失败");
    }
  });

  router.post("/api/prompt/optimize", requireAuth, async (request, response) => {
    try {
      const user = getAuthenticatedUser(request);

      if (user.role !== "admin") {
        const now = Date.now();
        const previous = lastOptimizeAt.get(user.id) || 0;

        if (now - previous < 3000) {
          throw new AuthError(429, "PROMPT_OPTIMIZER_RATE_LIMITED", "操作过于频繁，请稍后再试");
        }
        lastOptimizeAt.set(user.id, now);
      }

      const body = asRecord(request.body);
      const result = await service.optimize({
        prompt: String(body.prompt || ""),
        mode: body.mode === "standard" || body.mode === "concise" ? body.mode : "ecommerce",
        generationMode: body.generationMode === "text-to-image" ? "text-to-image" : "image-edit",
        provider: optionalString(body.provider),
        model: optionalString(body.model),
        modelName: optionalString(body.modelName),
        size: optionalString(body.size)
      });

      return response.json(result);
    } catch (error) {
      return sendAuthError(response, error, "AI 提示词优化失败");
    }
  });

  return router;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
