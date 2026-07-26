import { Router } from "express";
import {
  AuthError,
  type AuthService
} from "../auth.js";
import {
  createClearSessionCookie,
  createSessionCookie,
  readAuthToken
} from "../auth/cookies.js";
import type {
  SecurityLimitState,
  SecurityService
} from "../services/security.js";
import {
  sendAuthError
} from "../utils/express.js";

export function createAuthRouter(options: {
  authService: AuthService;
  securityService: SecurityService;
  secureAuthCookie: boolean;
}): Router {
  const {
    authService,
    securityService,
    secureAuthCookie
  } = options;

  const router = Router();

  router.get(
    "/api/auth/me",
    async (request, response) => {
      try {
        const user =
          await authService.getUserByToken(
            readAuthToken(
              request.headers.cookie
            )
          );

        if (!user) {
          return response.status(401).json({
            error: {
              code: "UNAUTHORIZED",
              message: "尚未登录"
            }
          });
        }

        return response.json({ user });
      } catch (error) {
        console.error("Auth me error", error);
        return response.status(500).json({
          error: {
            code: "AUTH_ERROR",
            message: "读取登录状态失败"
          }
        });
      }
    }
  );

  router.post(
    "/api/auth/register",
    async (request, response) => {
      const clientIp = getClientIp(request);
      const userAgent =
        request.get("user-agent");

      try {
        const rate =
          await securityService.consumeAttempt(
            "auth.register.ip",
            clientIp,
            securityService.policies.registerIp
          );

        applyRateHeaders(response, rate);

        if (!rate.allowed) {
          await securityService.recordEvent({
            eventType: "auth.register_blocked",
            severity: "warning",
            success: false,
            clientIp,
            requestMethod: request.method,
            requestPath: request.originalUrl,
            reason: "注册 IP 限频触发",
            details: {
              retryAfterSeconds:
                rate.retryAfterSeconds,
              userAgent
            }
          });

          throw new AuthError(
            429,
            "REGISTER_RATE_LIMITED",
            "注册请求过于频繁，请稍后再试"
          );
        }

        const body = request.body as {
          username?: unknown;
          password?: unknown;
        };

        const result =
          await authService.register(
            body?.username,
            body?.password
          );

        if (result.token) {
          response.setHeader(
            "Set-Cookie",
            createSessionCookie(
              result.token,
              authService.sessionTtlSeconds,
              secureAuthCookie
            )
          );
        }

        return response.status(201).json({
          success: true,
          user: result.user,
          pending: result.pending
        });
      } catch (error) {
        if (
          error instanceof AuthError &&
          error.code !== "REGISTER_RATE_LIMITED"
        ) {
          await safeRecordSecurityEvent(
            securityService,
            {
              eventType: "auth.register_failed",
              severity: "info",
              success: false,
              clientIp,
              requestMethod: request.method,
              requestPath: request.originalUrl,
              reason: error.code,
              details: { userAgent }
            }
          );
        }

        return sendAuthError(
          response,
          error,
          "注册失败"
        );
      }
    }
  );

  router.post(
    "/api/auth/login",
    async (request, response) => {
      const clientIp = getClientIp(request);
      const userAgent =
        request.get("user-agent");
      const body = request.body as {
        username?: unknown;
        password?: unknown;
      };
      const accountKey =
        normalizeAccountKey(body?.username);

      try {
        const [ipState, accountState] =
          await Promise.all([
            securityService.checkLimit(
              "auth.login.ip",
              clientIp,
              securityService.policies.loginIp
            ),
            securityService.checkLimit(
              "auth.login.account",
              accountKey,
              securityService.policies.loginAccount
            )
          ]);

        const blocked =
          !ipState.allowed
            ? ipState
            : !accountState.allowed
              ? accountState
              : undefined;

        if (blocked) {
          applyRateHeaders(response, blocked);

          await securityService.recordEvent({
            eventType: "auth.login_blocked",
            severity: "warning",
            success: false,
            username:
              normalizeAuditUsername(
                body?.username
              ),
            clientIp,
            requestMethod: request.method,
            requestPath: request.originalUrl,
            reason: "登录 IP 或账号锁定",
            details: {
              retryAfterSeconds:
                blocked.retryAfterSeconds,
              userAgent
            }
          });

          throw new AuthError(
            429,
            "LOGIN_RATE_LIMITED",
            "登录尝试过多，请稍后再试"
          );
        }

        const result =
          await authService.login(
            body?.username,
            body?.password,
            {
              clientIp,
              userAgent
            }
          );

        await securityService.resetLimit(
          "auth.login.account",
          accountKey
        );

        response.setHeader(
          "Set-Cookie",
          createSessionCookie(
            result.token,
            authService.sessionTtlSeconds,
            secureAuthCookie
          )
        );

        return response.json({
          success: true,
          user: result.user
        });
      } catch (error) {
        if (
          error instanceof AuthError &&
          error.code === "INVALID_CREDENTIALS"
        ) {
          const [ipFailure, accountFailure] =
            await Promise.all([
              securityService.consumeAttempt(
                "auth.login.ip",
                clientIp,
                securityService.policies.loginIp
              ),
              securityService.consumeAttempt(
                "auth.login.account",
                accountKey,
                securityService.policies.loginAccount
              )
            ]);

          const strictest =
            ipFailure.remaining <=
              accountFailure.remaining
              ? ipFailure
              : accountFailure;

          applyRateHeaders(
            response,
            strictest
          );

          await safeRecordSecurityEvent(
            securityService,
            {
              eventType: "auth.login_failed",
              severity:
                strictest.remaining === 0
                  ? "warning"
                  : "info",
              success: false,
              username:
                normalizeAuditUsername(
                  body?.username
                ),
              clientIp,
              requestMethod: request.method,
              requestPath: request.originalUrl,
              reason: "用户名或密码不正确",
              details: {
                remaining:
                  strictest.remaining,
                userAgent
              }
            }
          );
        }

        return sendAuthError(
          response,
          error,
          "登录失败"
        );
      }
    }
  );

  router.post(
    "/api/auth/logout",
    async (request, response) => {
      try {
        await authService.logout(
          readAuthToken(
            request.headers.cookie
          )
        );
      } catch (error) {
        console.error("Logout error", error);
      }

      response.setHeader(
        "Set-Cookie",
        createClearSessionCookie(
          secureAuthCookie
        )
      );

      return response.json({ success: true });
    }
  );

  return router;
}

function getClientIp(
  request: {
    ip?: string;
    socket: {
      remoteAddress?: string;
    };
  }
): string {
  return request.ip ||
    request.socket.remoteAddress ||
    "unknown";
}

function normalizeAccountKey(
  value: unknown
): string {
  if (typeof value !== "string") {
    return "invalid";
  }

  return value
    .trim()
    .toLocaleLowerCase("zh-CN")
    .slice(0, 64) || "invalid";
}

function normalizeAuditUsername(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized
    ? normalized.slice(0, 64)
    : undefined;
}

function applyRateHeaders(
  response: {
    setHeader(
      name: string,
      value: string
    ): void;
  },
  state: SecurityLimitState
): void {
  response.setHeader(
    "X-RateLimit-Limit",
    String(state.limit)
  );
  response.setHeader(
    "X-RateLimit-Remaining",
    String(state.remaining)
  );

  if (state.retryAfterSeconds > 0) {
    response.setHeader(
      "Retry-After",
      String(state.retryAfterSeconds)
    );
  }
}

async function safeRecordSecurityEvent(
  securityService: SecurityService,
  input: Parameters<
    SecurityService["recordEvent"]
  >[0]
): Promise<void> {
  try {
    await securityService.recordEvent(input);
  } catch (error) {
    console.error(
      "记录安全事件失败",
      error
    );
  }
}
