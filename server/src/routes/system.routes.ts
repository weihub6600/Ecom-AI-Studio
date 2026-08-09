import {
  Router,
  type RequestHandler
} from "express";
import type { ModelSettingsService } from "../services/model-settings.js";
import type { HealthService } from "../services/health.js";
import type { CustomProviderService } from "../services/custom-providers.js";

export function createSystemRouter(options: {
  modelSettingsService: ModelSettingsService;
  customProviderService: CustomProviderService;
  healthService: HealthService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}): Router {
  const router = Router();

  router.get("/api/health", async (_request, response) => {
    try {
      const report = await options.healthService.checkPublic();
      return response.status(report.status === "critical" ? 503 : 200).json(report);
    } catch (error) {
      console.error("公开健康检查失败", error);
      return response.status(503).json({
        ok: false,
        status: "critical",
        service: "ecom-ai-studio-api",
        checkedAt: new Date().toISOString()
      });
    }
  });

  router.get(
    "/api/admin/health",
    options.requireAuth,
    options.requireAdmin,
    async (_request, response) => {
      try {
        const report = await options.healthService.check();
        return response.status(report.status === "critical" ? 503 : 200).json(report);
      } catch (error) {
        console.error("管理员健康检查失败", error);
        return response.status(503).json({
          ok: false,
          status: "critical",
          service: "ecom-ai-studio-api",
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "健康检查失败"
        });
      }
    }
  );

  router.get("/api/models", (_request, response) => {
    const models = [
      ...options.modelSettingsService.listPublicModels(),
      ...options.customProviderService.listPublicModels()
    ].sort((a, b) =>
      (a.providerSortOrder ?? 9999) - (b.providerSortOrder ?? 9999) ||
      a.provider.localeCompare(b.provider) ||
      a.name.localeCompare(b.name)
    );
    response.json({ models });
  });

  return router;
}
