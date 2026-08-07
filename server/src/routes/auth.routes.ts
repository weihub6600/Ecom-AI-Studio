import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import type {
  RegistrationSettingsService
} from "../services/registration-settings.js";
import type {
  InvitationRewardService
} from "../services/invitation-rewards.js";
import type {
  RequestHandler
} from "express";
import {
  createSimpleRateLimit
} from "../middleware/rate-limit.js";
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

  registrationSettingsService:
    RegistrationSettingsService;
  invitationRewardService:
    InvitationRewardService;
  requireAuth:
    RequestHandler;
  requireAdmin:
    RequestHandler;}): Router {
  const {
    authService,
    securityService,
    secureAuthCookie,
    registrationSettingsService,
    invitationRewardService,
    requireAuth,
    requireAdmin
  } = options;

  const router = Router();
  const captchaRateLimit =
    createSimpleRateLimit({
      windowMs:
        15 * 60 * 1000,
      maxAttempts: 80
    });

  router.get(
    "/api/auth/registration-policy",
    async (
      _request,
      response
    ) => {
      try {
        const [registration, invitation] =
          await Promise.all([
            registrationSettingsService.get(),
            invitationRewardService.getPublicSettings()
          ]);

        return response.json({
          registration,
          invitation
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "读取注册政策失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/registration-settings",
    requireAuth,
    requireAdmin,
    async (
      _request,
      response
    ) => {
      try {
        return response.json({
          registration:
            await registrationSettingsService
              .get()
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "读取注册审核设置失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/registration-settings",
    requireAuth,
    requireAdmin,
    async (
      request,
      response
    ) => {
      try {
        const body =
          request.body as {
            requiresApproval?: unknown;
            registrationBonusEnabled?: unknown;
            registrationBonusPoints?: unknown;
          };

        const actor =
          getAuthenticatedUser(
            request
          );

        const registration =
          await registrationSettingsService
              .update(
                body || {},
                actor.id
              );

        return response.json({
          success: true,
          registration
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "保存注册审核设置失败"
        );
      }
    }
  );

  router.get(
    "/api/auth/captcha",
    captchaRateLimit,
    async (
      _request,
      response
    ) => {
      try {
        const captcha =
          await authService
            .createCaptcha();

        response.setHeader(
          "Cache-Control",
          "no-store"
        );

        return response.json({
          captcha
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "验证码加载失败"
        );
      }
    }
  );

  router.get(
    "/api/auth/captcha/:captchaId/image",
    captchaRateLimit,
    async (
      request,
      response
    ) => {
      try {
        const image =
          await authService
            .readCaptchaImage(
              request.params
                .captchaId
            );

        if (!image) {
          return response
            .status(404)
            .json({
              error: {
                code:
                  "CAPTCHA_NOT_FOUND",
                message:
                  "验证码已失效，请刷新"
              }
            });
        }

        response.setHeader(
          "Content-Type",
          "image/svg+xml; charset=utf-8"
        );

        response.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate"
        );

        response.setHeader(
          "Content-Security-Policy",
          "default-src 'none'"
        );

        return response.send(image);
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "验证码读取失败"
        );
      }
    }
  );

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

        const body =
        request.body as {
          username?: unknown;
          password?: unknown;
          captchaId?: unknown;
          captchaAnswer?: unknown;
          inviteCode?: unknown;
        };

        await authService
          .verifyCaptcha(
            body?.captchaId,
            body?.captchaAnswer
          );

        const registrationPolicy =
          await registrationSettingsService
            .get();

        const result =
          await authService.register(
            body?.username,
            body?.password,
            registrationPolicy
              .requiresApproval,
            {
              clientIp,
              userAgent
            }
          );

        let registeredUser =
          result.user;

        try {
          registeredUser =
            await registrationSettingsService
              .grantRegistrationBonus(
                result.user
              );
        }
        catch (registrationBonusError) {
          console.error(
            "发放注册赠送积分失败",
            registrationBonusError
          );
        }

        let invitedUser = registeredUser;
        try {
          invitedUser =
            await invitationRewardService
              .recordRegistration(
                registeredUser,
                body?.inviteCode
              );
        }
        catch (invitationError) {
          console.error(
            "记录邀请关系失败",
            invitationError
          );
        }

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
          user: invitedUser,
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
      const body =
        request.body as {
          username?: unknown;
        password?: unknown;
          captchaId?: unknown;
          captchaAnswer?: unknown;
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

        await authService
          .verifyCaptcha(
            body?.captchaId,
            body?.captchaAnswer
          );

        const result =
          await authService.login(
            body?.username,
            body?.password,
            {
              clientIp,
              userAgent
            }
          );

        let activatedUser = result.user;
        try {
          activatedUser =
            await invitationRewardService
              .rewardActivatedUser(
                result.user.id
              ) || result.user;
        }
        catch (invitationError) {
          console.error(
            "补发邀请奖励失败",
            invitationError
          );
        }

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
          user: activatedUser
        });
      } catch (error) {
        if (
          error instanceof AuthError &&
          shouldRecordRouteLoginFailure(
            error.code
          )
        ) {
          await safeRecordLoginAttempt(
            authService,
            body?.username,
            error.message,
            clientIp,
            userAgent
          );
        }

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

function shouldRecordRouteLoginFailure(
  code: string
): boolean {
  return (
    code === "LOGIN_RATE_LIMITED" ||
    code === "INVALID_USERNAME" ||
    code === "INVALID_PASSWORD" ||
    code.startsWith("CAPTCHA_") ||
    code === "INVALID_CAPTCHA"
  );
}

async function safeRecordLoginAttempt(
  authService: AuthService,
  username: unknown,
  reason: string,
  clientIp: string,
  userAgent: string | undefined
): Promise<void> {
  try {
    await authService
      .recordLoginAttempt(
        username,
        false,
        reason,
        {
          clientIp,
          userAgent
        }
      );
  }
  catch (auditError) {
    console.error(
      "记录登录审计失败",
      auditError
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
