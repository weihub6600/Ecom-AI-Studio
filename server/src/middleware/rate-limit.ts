import type { NextFunction, Request, RequestHandler, Response } from "express";

export function createSimpleRateLimit(options: { windowMs: number; maxAttempts: number }): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.maxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({ error: { code: "TOO_MANY_AUTH_ATTEMPTS", message: "登录或注册尝试过于频繁，请稍后再试" } });
      return;
    }

    current.count += 1;
    if (buckets.size > 10_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    next();
  };
}
