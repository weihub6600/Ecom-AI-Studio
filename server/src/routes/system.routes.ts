import { Router } from "express";
import type { ModelSettingsService } from "../services/model-settings.js";

export function createSystemRouter(options: { modelSettingsService: ModelSettingsService }): Router {
  const router = Router();

  router.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "ecom-ai-studio-api", time: new Date().toISOString() });
  });

  router.get("/api/models", (_request, response) => {
    response.json({ models: options.modelSettingsService.listPublicModels() });
  });

  return router;
}
