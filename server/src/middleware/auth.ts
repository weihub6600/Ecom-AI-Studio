import type { Request, RequestHandler } from "express";
import type { AuthService, PublicUser } from "../auth.js";
import { readAuthToken } from "../auth/cookies.js";

export interface AuthenticatedRequest extends Request {
  authUser?: PublicUser;
}

export function createAuthMiddleware(authService: AuthService): {
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
} {
  const requireAuth: RequestHandler = async (request, response, next) => {
    try {
      const user = await authService.getUserByToken(readAuthToken(request.headers.cookie));
      if (!user) {
        response.status(401).json({ error: { code: "UNAUTHORIZED", message: "请先登录后再使用网站功能" } });
        return;
      }
      (request as AuthenticatedRequest).authUser = user;
      next();
    } catch (error) {
      console.error("Authentication error", error);
      response.status(500).json({ error: { code: "AUTH_ERROR", message: "登录状态验证失败" } });
    }
  };

  const requireAdmin: RequestHandler = (request, response, next) => {
    const user = (request as AuthenticatedRequest).authUser;
    if (!user || user.role !== "admin") {
      response.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "只有站长可以访问管理后台" } });
      return;
    }
    next();
  };

  return { requireAuth, requireAdmin };
}

export function getAuthenticatedUser(request: Request): PublicUser {
  const user = (request as AuthenticatedRequest).authUser;
  if (!user) throw new Error("Authenticated route is missing authUser");
  return user;
}
