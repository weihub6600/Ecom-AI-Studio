import { Router } from "express";
import type { AuthService } from "../auth.js";
import { createClearSessionCookie, createSessionCookie, readAuthToken } from "../auth/cookies.js";
import { createSimpleRateLimit } from "../middleware/rate-limit.js";
import { sendAuthError } from "../utils/express.js";

export function createAuthRouter(options: {
  authService: AuthService;
  secureAuthCookie: boolean;
}): Router {
  const { authService, secureAuthCookie } = options;
  const router = Router();
  const authRateLimit = createSimpleRateLimit({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

  router.get("/api/auth/me", async (request, response) => {
    try {
      const user = await authService.getUserByToken(readAuthToken(request.headers.cookie));
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED", message: "尚未登录" } });
      return response.json({ user });
    } catch (error) {
      console.error("Auth me error", error);
      return response.status(500).json({ error: { code: "AUTH_ERROR", message: "读取登录状态失败" } });
    }
  });

  router.post("/api/auth/register", authRateLimit, async (request, response) => {
    try {
      const body = request.body as { username?: unknown; password?: unknown };
      const result = await authService.register(body?.username, body?.password);
      if (result.token) response.setHeader("Set-Cookie", createSessionCookie(result.token, authService.sessionTtlSeconds, secureAuthCookie));
      return response.status(201).json({ success: true, user: result.user, pending: result.pending });
    } catch (error) {
      return sendAuthError(response, error, "注册失败");
    }
  });

  router.post("/api/auth/login", authRateLimit, async (request, response) => {
    try {
      const body = request.body as { username?: unknown; password?: unknown };
      const result = await authService.login(body?.username, body?.password, {
        clientIp: request.ip,
        userAgent: request.get("user-agent")
      });
      response.setHeader("Set-Cookie", createSessionCookie(result.token, authService.sessionTtlSeconds, secureAuthCookie));
      return response.json({ success: true, user: result.user });
    } catch (error) {
      return sendAuthError(response, error, "登录失败");
    }
  });

  router.post("/api/auth/logout", async (request, response) => {
    try {
      await authService.logout(readAuthToken(request.headers.cookie));
    } catch (error) {
      console.error("Logout error", error);
    }
    response.setHeader("Set-Cookie", createClearSessionCookie(secureAuthCookie));
    return response.json({ success: true });
  });

  return router;
}
