import { Router } from "express";
import type {
  ModelSettingsService
} from "../services/model-settings.js";
import type {
  HealthService
} from "../services/health.js";

export function createSystemRouter(options: {
  modelSettingsService: ModelSettingsService;
  healthService: HealthService;
}): Router {
  const router = Router();

  router.get(
    "/api/health",
    async (_request, response) => {
      try {
        const report =
          await options.healthService.check();

        return response
          .status(
            report.status === "critical"
              ? 503
              : 200
          )
          .json(report);
      }
      catch (error) {
        console.error(
          "健康检查失败",
          error
        );

        return response
          .status(503)
          .json({
            ok: false,
            status: "critical",
            service:
              "ecom-ai-studio-api",
            checkedAt:
              new Date().toISOString(),
            error:
              error instanceof Error
                ? error.message
                : "健康检查失败"
          });
      }
    }
  );

  router.get(
    "/api/models",
    (_request, response) => {
      response.json({
        models:
          options.modelSettingsService
            .listPublicModels()
      });
    }
  );

  return router;
}