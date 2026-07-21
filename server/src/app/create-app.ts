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

export function createApp(context: AppContext): Express {
  const app = express();

  const {
    requireAuth,
    requireAdmin
  } = createAuthMiddleware(context.authService);

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
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
    requireAuth
  }));

  app.use(createAdminRouter({
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
    auditLogService: context.auditLogService,
    adminQueryService: context.adminQueryService,
    requireAuth,
    requireAdmin
  }));

  app.use(createHistoryRouter({
    historyService: context.historyService,
    requireAuth
  }));

  app.use(createGenerationRouter({
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
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