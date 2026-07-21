import type {
  NextFunction,
  Request,
  RequestHandler,
  Response
} from "express";

export interface RateLimitOptions {
  windowMs: number;
  maxAttempts: number;
  code?: string;
  message?: string;
  keyGenerator?: (request: Request) => string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function createSimpleRateLimit(
  options: RateLimitOptions
): RequestHandler {
  const windowMs = positiveInteger(
    options.windowMs,
    60_000
  );

  const maxAttempts = positiveInteger(
    options.maxAttempts,
    20
  );

  const buckets = new Map<string, RateLimitBucket>();
  let cleanupCounter = 0;

  return (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    const now = Date.now();

    const key =
      options.keyGenerator?.(request) ||
      request.ip ||
      request.socket.remoteAddress ||
      "unknown";

    const current = buckets.get(key);

    response.setHeader(
      "X-RateLimit-Limit",
      String(maxAttempts)
    );

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs
      });

      response.setHeader(
        "X-RateLimit-Remaining",
        String(Math.max(0, maxAttempts - 1))
      );

      next();
      return;
    }

    if (current.count >= maxAttempts) {
      const retryAfter = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000)
      );

      response.setHeader(
        "Retry-After",
        String(retryAfter)
      );

      response.setHeader(
        "X-RateLimit-Remaining",
        "0"
      );

      response.status(429).json({
        error: {
          code:
            options.code ||
            "TOO_MANY_REQUESTS",
          message:
            options.message ||
            "请求过于频繁，请稍后再试"
        }
      });

      return;
    }

    current.count += 1;

    response.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxAttempts - current.count))
    );

    cleanupCounter += 1;

    if (
      cleanupCounter >= 1000 ||
      buckets.size > 10_000
    ) {
      cleanupCounter = 0;

      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}

function positiveInteger(
  value: number,
  fallback: number
): number {
  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}