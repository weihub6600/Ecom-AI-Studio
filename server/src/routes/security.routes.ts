import {
  Router,
  type RequestHandler
} from "express";
import type {
  SecurityService
} from "../services/security.js";

export function createSecurityRouter(
  options: {
    securityService: SecurityService;
    issueCsrfToken: RequestHandler;
    requireAuth: RequestHandler;
    requireAdmin: RequestHandler;
  }
): Router {
  const router = Router();

  router.get(
    "/api/security/csrf",
    options.issueCsrfToken
  );

  router.get(
    "/api/admin/security/summary",
    options.requireAuth,
    options.requireAdmin,
    async (_request, response) => {
      try {
        const summary =
          await options.securityService
            .getSummary();

        return response.json({ summary });
      } catch (error) {
        console.error(
          "读取安全摘要失败",
          error
        );

        return response.status(500).json({
          error: {
            code: "SECURITY_SUMMARY_ERROR",
            message: "读取安全摘要失败"
          }
        });
      }
    }
  );

  router.get(
    "/api/admin/security/events",
    options.requireAuth,
    options.requireAdmin,
    async (request, response) => {
      try {
        const rawLimit =
          typeof request.query.limit === "string"
            ? Number(request.query.limit)
            : 100;

        const events =
          await options.securityService
            .listEvents(rawLimit);

        return response.json({ events });
      } catch (error) {
        console.error(
          "读取安全事件失败",
          error
        );

        return response.status(500).json({
          error: {
            code: "SECURITY_EVENTS_ERROR",
            message: "读取安全事件失败"
          }
        });
      }
    }
  );

  return router;
}
