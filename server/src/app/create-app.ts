import express, { type Express } from "express";
import path from "node:path";
import type { AppContext } from "./context.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createSystemRouter } from "../routes/system.routes.js";
import { createAuthRouter } from "../routes/auth.routes.js";
import { createAccountRouter } from "../routes/account.routes.js";
import { createAdminRouter } from "../routes/admin.routes.js";
import { createHistoryRouter } from "../routes/history.routes.js";
import { createGenerationRouter } from "../routes/generation.routes.js";
import { createBatchRouter } from "../routes/batch.routes.js";
import { createLibraryRouter } from "../routes/library.routes.js";
import { createWorkLibraryService } from "../services/work-library.js";

export function createApp(context: AppContext): Express {
  const app = express();

  const {
    requireAuth,
    requireAdmin
  } = createAuthMiddleware(context.authService);

  const workLibraryService =
    createWorkLibraryService(
      context.database
    );

  app.disable("x-powered-by");

  app.use(express.json({
    limit: "120mb"
  }));

  app.use((_request, response, next) => {
    response.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    response.setHeader(
      "X-Frame-Options",
      "DENY"
    );

    response.setHeader(
      "Referrer-Policy",
      "same-origin"
    );

    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );

    next();
  });

  app.use(createSystemRouter({
    modelSettingsService: context.modelSettingsService,
    healthService: context.healthService
  }));

  app.use(createAuthRouter({
    authService: context.authService,
    secureAuthCookie: context.secureAuthCookie
  }));

  app.use(createAccountRouter({
    database: context.database,
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
    requireAuth
  }));

  app.use(createLibraryRouter({
    workLibraryService,
    requireAuth
  }));

  app.use(createAdminRouter({
    database: context.database,
    authService: context.authService,
    historyService: context.historyService,
    modelSettingsService: context.modelSettingsService,
    auditLogService: context.auditLogService,
    adminQueryService: context.adminQueryService,
    requireAuth,
    requireAdmin
  }));

  app.use(createBatchRouter({
    batchJobService: context.batchJobService,
    requireAuth
  }));

  app.use(createHistoryRouter({
    historyService: context.historyService,
    requireAuth
  }));

  app.use(createGenerationRouter({
    database: context.database,
    authService: context.authService,
    historyService: context.historyService,
    modelSettingsService: context.modelSettingsService,
    batchWorkerSecret: context.batchJobService.workerSecret,
    requireAuth
  }));

  app.use(express.static(context.webDist));

  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/")) {
      return next();
    }

    response.sendFile(
      path.join(context.webDist, "index.html"),
      (error) => {
        if (error) next();
      }
    );
  });

  return app;
}