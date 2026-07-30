import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import type {
  ErrorRequestHandler,
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response
} from "express";
import {
  readAuthToken
} from "../auth/cookies.js";

const CSRF_COOKIE_NAME =
  "ecom_ai_csrf";
const CSRF_BINDING_COOKIE_NAME =
  "ecom_ai_csrf_binding";
const CSRF_HEADER_NAME =
  "x-csrf-token";

export interface CsrfRejectEvent {
  reason: string;
  clientIp?: string;
  requestMethod?: string;
  requestPath?: string;
  origin?: string;
  secFetchSite?: string;
}

export function configureTrustProxy(
  app: Express
): void {
  const setting = readTrustProxySetting();

  if (setting !== false) {
    app.set("trust proxy", setting);
  }
}

export function createSecurityHeaders(
  options: {
    secureCookie: boolean;
  }
): RequestHandler {
  const production =
    process.env.NODE_ENV === "production";

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    production
      ? "img-src 'self' data: blob: https:"
      : "img-src 'self' data: blob: https: http:",
    production
      ? "connect-src 'self' https:"
      : "connect-src 'self' https: http: ws: wss:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:",
    "frame-src 'none'",
    "manifest-src 'self'"
  ].join("; ");

  return (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    response.setHeader(
      "Content-Security-Policy",
      csp
    );
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
      "strict-origin-when-cross-origin"
    );
    response.setHeader(
      "Permissions-Policy",
      [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "serial=()",
        "bluetooth=()"
      ].join(", ")
    );
    response.setHeader(
      "Cross-Origin-Opener-Policy",
      "same-origin"
    );
    response.setHeader(
      "Cross-Origin-Resource-Policy",
      "same-origin"
    );
    response.setHeader(
      "Origin-Agent-Cluster",
      "?1"
    );
    response.setHeader(
      "X-Permitted-Cross-Domain-Policies",
      "none"
    );
    response.setHeader(
      "X-Download-Options",
      "noopen"
    );

    if (
      options.secureCookie &&
      request.secure &&
      process.env.SECURITY_HSTS_ENABLED !==
        "false"
    ) {
      const maxAge = readPositiveEnv(
        "SECURITY_HSTS_MAX_AGE_SECONDS",
        31_536_000,
        300,
        63_072_000
      );

      const includeSubDomains =
        process.env
          .SECURITY_HSTS_INCLUDE_SUBDOMAINS !==
        "false";

      const preload =
        process.env.SECURITY_HSTS_PRELOAD ===
        "true";

      response.setHeader(
        "Strict-Transport-Security",
        [
          `max-age=${maxAge}`,
          includeSubDomains
            ? "includeSubDomains"
            : "",
          preload ? "preload" : ""
        ].filter(Boolean).join("; ")
      );
    }

    if (
      request.path.startsWith("/api/auth/") ||
      request.path.startsWith("/api/account/") ||
      request.path.startsWith("/api/admin/") ||
      request.path.startsWith("/api/security/")
    ) {
      response.setHeader(
        "Cache-Control",
        "no-store, max-age=0"
      );
      response.setHeader(
        "Pragma",
        "no-cache"
      );
    }

    next();
  };
}

export function createCsrfProtection(
  options: {
    secureCookie: boolean;
    internalWorkerSecret?: string;
    onReject?: (
      event: CsrfRejectEvent
    ) => void | Promise<void>;
  }
): {
  issueToken: RequestHandler;
  middleware: RequestHandler;
} {
  const configuredSecret =
    process.env.CSRF_SECRET?.trim();

  const secret =
    configuredSecret &&
    configuredSecret.length >= 32
      ? configuredSecret
      : randomBytes(48).toString("base64url");

  if (
    process.env.NODE_ENV === "production" &&
    !configuredSecret
  ) {
    console.warn(
      "CSRF_SECRET 未配置；本次启动使用临时密钥。重启后前端会自动刷新 CSRF 令牌。"
    );
  }

  const trustedOrigins =
    readTrustedOrigins();

  const issueToken: RequestHandler =
    (request, response) => {
      const binding = getBinding(
        request,
        response,
        options.secureCookie,
        true
      );

      if (!binding) {
        return response.status(500).json({
          error: {
            code: "CSRF_BINDING_ERROR",
            message: "无法创建安全请求令牌"
          }
        });
      }

      const token = createToken(
        binding,
        secret
      );

      response.append(
        "Set-Cookie",
        createCookie(
          CSRF_COOKIE_NAME,
          token,
          {
            secure: options.secureCookie,
            httpOnly: false,
            maxAgeSeconds: 12 * 60 * 60
          }
        )
      );

      return response.json({
        csrfToken: token,
        headerName: "X-CSRF-Token"
      });
    };

  const middleware: RequestHandler =
    async (request, response, next) => {
      if (isSafeMethod(request.method)) {
        next();
        return;
      }

      if (
        isInternalWorkerRequest(
          request,
          options.internalWorkerSecret
        )
      ) {
        next();
        return;
      }

      const originFailure =
        validateRequestOrigin(
          request,
          trustedOrigins
        );

      if (originFailure) {
        await reject(
          request,
          response,
          originFailure
        );
        return;
      }

      const headerToken =
        request.get(CSRF_HEADER_NAME);
      const cookieToken =
        readCookie(
          request.headers.cookie,
          CSRF_COOKIE_NAME
        );

      if (
        !headerToken ||
        !cookieToken ||
        !safeEqual(headerToken, cookieToken)
      ) {
        await reject(
          request,
          response,
          "缺少或不匹配的 CSRF 令牌"
        );
        return;
      }

      const binding = getBinding(
        request,
        response,
        options.secureCookie,
        false
      );

      if (
        !binding ||
        !verifyToken(
          headerToken,
          binding,
          secret
        )
      ) {
        await reject(
          request,
          response,
          "CSRF 令牌签名无效或已过期"
        );
        return;
      }

      next();
    };

  async function reject(
    request: Request,
    response: Response,
    reason: string
  ): Promise<Response> {
    try {
      await options.onReject?.({
        reason,
        clientIp:
          request.ip ||
          request.socket.remoteAddress ||
          undefined,
        requestMethod: request.method,
        requestPath: request.originalUrl,
        origin: request.get("origin"),
        secFetchSite:
          request.get("sec-fetch-site")
      });
    } catch (error) {
      console.error(
        "记录 CSRF 拒绝事件失败",
        error
      );
    }

    return response.status(403).json({
      error: {
        code: "CSRF_VALIDATION_FAILED",
        message: "安全验证已失效，请刷新后重试"
      }
    });
  }

  return {
    issueToken,
    middleware
  };
}

export function createJsonBodyErrorHandler():
  ErrorRequestHandler {
  return (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction
  ) => {
    if (
      isPayloadTooLarge(error)
    ) {
      response.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "请求数据超过接口允许大小"
        }
      });
      return;
    }

    if (isInvalidJson(error)) {
      response.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "JSON 请求格式不正确"
        }
      });
      return;
    }

    next(error);
  };
}

export function readJsonLimit(
  name: string,
  fallback: string
): string {
  const value = process.env[name]?.trim();
  return value &&
    /^\d+(?:kb|mb|gb)$/i.test(value)
      ? value
      : fallback;
}

function getBinding(
  request: Request,
  response: Response,
  secureCookie: boolean,
  createAnonymous: boolean
): string | undefined {
  const sessionToken =
    readAuthToken(request.headers.cookie);

  if (sessionToken) {
    return `session:${createHash("sha256")
      .update(sessionToken)
      .digest("hex")}`;
  }

  const existing = readCookie(
    request.headers.cookie,
    CSRF_BINDING_COOKIE_NAME
  );

  if (
    existing &&
    /^[A-Za-z0-9_-]{32,160}$/.test(existing)
  ) {
    return `anonymous:${existing}`;
  }

  if (!createAnonymous) {
    return undefined;
  }

  const binding =
    randomBytes(32).toString("base64url");

  response.append(
    "Set-Cookie",
    createCookie(
      CSRF_BINDING_COOKIE_NAME,
      binding,
      {
        secure: secureCookie,
        httpOnly: true,
        maxAgeSeconds: 24 * 60 * 60
      }
    )
  );

  return `anonymous:${binding}`;
}

function createToken(
  binding: string,
  secret: string
): string {
  const nonce =
    randomBytes(32).toString("base64url");
  const signature =
    createHmac("sha256", secret)
      .update(`${binding}.${nonce}`)
      .digest("base64url");

  return `${nonce}.${signature}`;
}

function verifyToken(
  token: string,
  binding: string,
  secret: string
): boolean {
  const parts = token.split(".");
  const nonce = parts[0];
  const signature = parts[1];

  if (
    parts.length !== 2 ||
    !nonce ||
    !signature ||
    !/^[A-Za-z0-9_-]{32,160}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{32,160}$/.test(signature)
  ) {
    return false;
  }

  const expected =
    createHmac("sha256", secret)
      .update(`${binding}.${nonce}`)
      .digest("base64url");

  return safeEqual(signature, expected);
}

function validateRequestOrigin(
  request: Request,
  trustedOrigins: Set<string>
): string | undefined {
  const secFetchSite =
    request.get("sec-fetch-site")
      ?.toLowerCase();

  if (secFetchSite === "cross-site") {
    return "拒绝跨站状态修改请求";
  }

  const allowed = new Set(trustedOrigins);
  const host = request.get("host");

  if (host) {
    allowed.add(
      `${request.protocol}://${host}`
    );
  }

  const origin = request.get("origin");
  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized || !allowed.has(normalized)) {
      return "请求 Origin 不在允许列表";
    }
    return undefined;
  }

  const referer = request.get("referer");
  if (referer) {
    const normalized = normalizeOrigin(referer);
    if (!normalized || !allowed.has(normalized)) {
      return "请求 Referer 不在允许列表";
    }
  }

  return undefined;
}

function readTrustedOrigins(): Set<string> {
  const origins = new Set<string>();

  for (
    const value of
    (process.env.CSRF_TRUSTED_ORIGINS || "")
      .split(",")
  ) {
    const normalized = normalizeOrigin(value);
    if (normalized) origins.add(normalized);
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:8787");
    origins.add("http://127.0.0.1:8787");
  }

  return origins;
}

function normalizeOrigin(
  value: string
): string | undefined {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function readCookie(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    const key = part
      .slice(0, separator)
      .trim();

    if (key !== name) continue;

    try {
      return decodeURIComponent(
        part.slice(separator + 1).trim()
      );
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function createCookie(
  name: string,
  value: string,
  options: {
    secure: boolean;
    httpOnly: boolean;
    maxAgeSeconds: number;
  }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.max(
      1,
      Math.trunc(options.maxAgeSeconds)
    )}`
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function isSafeMethod(method: string): boolean {
  return method === "GET" ||
    method === "HEAD" ||
    method === "OPTIONS";
}

function isInternalWorkerRequest(
  request: Request,
  expectedSecret: string | undefined
): boolean {
  if (!expectedSecret) return false;

  const provided =
    request.get("x-ecom-batch-worker");

  return Boolean(
    provided &&
    safeEqual(provided, expectedSecret)
  );
}

function safeEqual(
  left: string,
  right: string
): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length ===
      rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function readTrustProxySetting():
  false | true | number | string {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;

  const numeric = Number(raw);
  if (
    Number.isInteger(numeric) &&
    numeric >= 0
  ) {
    return numeric;
  }

  return raw;
}

function isPayloadTooLarge(
  error: unknown
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  return value.type === "entity.too.large" ||
    value.status === 413 ||
    value.statusCode === 413;
}

function isInvalidJson(
  error: unknown
): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const value = error as SyntaxError & {
    status?: unknown;
    type?: unknown;
  };

  return value.status === 400 &&
    value.type === "entity.parse.failed";
}

function readPositiveEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(
    minimum,
    Math.min(maximum, Math.trunc(value))
  );
}
