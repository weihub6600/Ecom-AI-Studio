import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler
} from "express";
import {
  AuthError
} from "../auth.js";
import path from "node:path";
import type {
  AppContext
} from "./context.js";
import {
  createAuthMiddleware
} from "../middleware/auth.js";
import {
  configureTrustProxy,
  createCsrfProtection,
  createJsonBodyErrorHandler,
  createSecurityHeaders,
  readJsonLimit
} from "../middleware/security.js";
import {
  createSystemRouter
} from "../routes/system.routes.js";
import {
  createSecurityRouter
} from "../routes/security.routes.js";
import {
  createAuthRouter
} from "../routes/auth.routes.js";
import {
  createInvitationRouter
} from "../routes/invitation.routes.js";
import {
  createAccountRouter
} from "../routes/account.routes.js";
import {
  createAdminRouter
} from "../routes/admin.routes.js";
import {
  createHistoryRouter
} from "../routes/history.routes.js";
import {
  createGenerationRouter
} from "../routes/generation.routes.js";
import {
  createBatchRouter
} from "../routes/batch.routes.js";
import {
  createLibraryRouter
} from "../routes/library.routes.js";
import {
  createCustomProviderRouter
} from "../routes/custom-provider.routes.js";
import {
  createWorkLibraryService
} from "../services/work-library.js";
import {
  createSecurityService
} from "../services/security.js";

const apiNotFoundHandler:
  RequestHandler =
    (request, response) => {
      response
        .status(404)
        .json({
          error: {
            code: "API_NOT_FOUND",
            message:
              `接口不存在：${request.method} ${request.originalUrl}`
          }
        });
    };

const globalApiErrorHandler:
  ErrorRequestHandler =
    (
      error,
      request,
      response,
      next
    ) => {
      if (response.headersSent) {
        next(error);
        return;
      }

      if (error instanceof AuthError) {
        response
          .status(error.status)
          .json({
            error: {
              code: error.code,
              message:
                error.message
            }
          });
        return;
      }

      console.error(
        "Unhandled API error",
        {
          method:
            request.method,
          path:
            request.originalUrl,
          error
        }
      );

      response
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",
            message:
              "服务器内部错误"
          }
        });
    };

export function createApp(
  context: AppContext
): Express {
  const app = express();

  configureTrustProxy(app);

  const {
    requireAuth,
    requireAdmin
  } = createAuthMiddleware(
    context.authService
  );

  const workLibraryService =
    createWorkLibraryService(
      context.database
    );

  const securityService =
    createSecurityService(
      context.database
    );

  const csrfProtection =
    createCsrfProtection({
      secureCookie:
        context.secureAuthCookie,
      internalWorkerSecret:
        context.batchJobService
          .workerSecret,
      onReject: (event) =>
        securityService.recordEvent({
          eventType: "csrf.rejected",
          severity: "warning",
          success: false,
          clientIp: event.clientIp,
          requestMethod:
            event.requestMethod,
          requestPath:
            event.requestPath,
          reason: event.reason,
          details: {
            origin: event.origin,
            secFetchSite:
              event.secFetchSite
          }
        })
    });

  app.disable("x-powered-by");

  app.use(
    createSecurityHeaders({
      secureCookie:
        context.secureAuthCookie
    })
  );

  app.use(
    createSecurityRouter({
      securityService,
      issueCsrfToken:
        csrfProtection.issueToken,
      requireAuth,
      requireAdmin
    })
  );

  app.use(
    "/api",
    csrfProtection.middleware
  );

  app.use(
    "/api/images/generate",
    express.json({
      limit: readJsonLimit(
        "GENERATION_JSON_LIMIT",
        "20mb"
      )
    })
  );

  app.use(
    "/api/batches",
    express.json({
      limit: readJsonLimit(
        "BATCH_JSON_LIMIT",
        "5mb"
      )
    })
  );

  app.use(
    express.json({
      limit: readJsonLimit(
        "DEFAULT_JSON_LIMIT",
        "1mb"
      )
    })
  );

  app.use(
    createJsonBodyErrorHandler()
  );

  app.use(createSystemRouter({
    modelSettingsService:
      context.modelSettingsService,
    customProviderService:
      context.customProviderService,
    healthService:
      context.healthService,
    requireAuth,
    requireAdmin
  }));

  app.use(createAuthRouter({
    requireAdmin:
      requireAdmin,
    requireAuth:
      requireAuth,
    registrationSettingsService:
      context.registrationSettingsService,
    invitationRewardService:
      context.invitationRewardService,
    authService: context.authService,
    securityService,
    secureAuthCookie:
      context.secureAuthCookie
  }));

    app.use(createInvitationRouter({
    invitationRewardService:
      context.invitationRewardService,
    requireAuth,
    requireAdmin
  }));

app.use(createAccountRouter({
    database: context.database,
    authService: context.authService,
    modelSettingsService:
      context.modelSettingsService,
    requireAuth
  }));

  app.use(createLibraryRouter({
    workLibraryService,
    requireAuth
  }));

  app.use(createAdminRouter({
    database: context.database,
    authService: context.authService,
    historyService:
      context.historyService,
    modelSettingsService:
      context.modelSettingsService,
    auditLogService:
      context.auditLogService,
    adminQueryService:
      context.adminQueryService,
    invitationRewardService:
      context.invitationRewardService,
    requireAuth,
    requireAdmin
  }));

  app.use(createCustomProviderRouter({
    customProviderService:
      context.customProviderService,
    builtInProviderSettingsService:
      context.builtInProviderSettingsService,
    modelSettingsService:
      context.modelSettingsService,
    requireAuth,
    requireAdmin
  }));

  app.use(createBatchRouter({
    batchJobService:
      context.batchJobService,
    requireAuth
  }));

  app.use(createHistoryRouter({
    historyService:
      context.historyService,
    requireAuth
  }));

  app.use(createGenerationRouter({
    database: context.database,
    authService: context.authService,
    historyService:
      context.historyService,
    modelSettingsService:
      context.modelSettingsService,
    customProviderService:
      context.customProviderService,
    batchWorkerSecret:
      context.batchJobService
        .workerSecret,
    requireAuth
  }));
  app.use(
    "/api",
    apiNotFoundHandler
  );

  app.use(
    "/api",
    globalApiErrorHandler
  );

  app.use(express.static(context.webDist));

  app.get(
    "/{*path}",
    (request, response, next) => {
      if (
        request.path.startsWith("/api/")
      ) {
        return next();
      }

      response.sendFile(
        path.join(
          context.webDist,
          "index.html"
        ),
        (error) => {
          if (error) next();
        }
      );
    }
  );

  return app;
}
