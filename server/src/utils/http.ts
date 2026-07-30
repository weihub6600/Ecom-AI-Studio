export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = Number(
    process.env.REQUEST_TIMEOUT_MS ||
    180_000
  )
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ProviderHttpError(
        "模型请求超时，请稍后重试",
        504
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonResponse(
  response: Response
): Promise<any> {
  const text = await response.text();
  let body: any;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {
      raw: text.slice(0, 2000)
    };
  }

  if (!response.ok) {
    throw new ProviderHttpError(
      publicProviderMessage(
        response.status,
        body
      ),
      normalizeProviderStatus(
        response.status
      ),
      redactProviderDetails(body)
    );
  }

  return body;
}

function publicProviderMessage(
  status: number,
  body: unknown
): string {
  const raw = extractProviderMessage(body);
  const normalized = raw.toLowerCase();

  if (
    normalized.includes("content policy") ||
    normalized.includes("safety") ||
    normalized.includes("moderation") ||
    normalized.includes("违规") ||
    normalized.includes("敏感")
  ) {
    return "请求可能不符合模型内容规范，请调整提示词后重试";
  }

  if (status === 400 || status === 422) {
    return "模型服务商拒绝了请求，请检查模型参数或参考图";
  }

  if (status === 401 || status === 403) {
    return "模型服务商鉴权失败，请联系站长检查 API 配置";
  }

  if (status === 404) {
    return "模型服务商未找到对应模型或任务";
  }

  if (status === 408 || status === 504) {
    return "模型服务商响应超时，请稍后重试";
  }

  if (status === 409) {
    return "模型服务商当前任务状态冲突，请稍后重试";
  }

  if (status === 429) {
    return "模型服务商请求过于频繁，请稍后重试";
  }

  if (status >= 500) {
    return "模型服务商暂时不可用，请稍后重试";
  }

  return "模型服务商请求失败，请稍后重试";
}

function normalizeProviderStatus(
  status: number
): number {
  return status >= 400 && status < 600
    ? status
    : 502;
}

function extractProviderMessage(
  body: unknown
): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const value = body as Record<string, any>;
  const candidates = [
    value.error?.message,
    value.message,
    value.error_msg,
    value.error
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate.slice(0, 1000);
    }
  }

  return "";
}

export function redactProviderDetails(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 5) return "[TRUNCATED]";

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return "[IMAGE_DATA_REDACTED]";
    }

    return value
      .replace(
        /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
        "Bearer [REDACTED]"
      )
      .replace(
        /(api[_-]?key|token|secret|password)=([^&\s]+)/gi,
        "$1=[REDACTED]"
      )
      .slice(0, 2000);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) =>
        redactProviderDetails(
          item,
          depth + 1
        )
      );
  }

  if (typeof value === "object") {
    const result:
      Record<string, unknown> = {};

    for (
      const [key, item] of
      Object.entries(
        value as Record<string, unknown>
      ).slice(0, 100)
    ) {
      if (
        /(authorization|cookie|password|secret|token|api.?key)/i
          .test(key)
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] =
          redactProviderDetails(
            item,
            depth + 1
          );
      }
    }

    return result;
  }

  return String(value).slice(0, 500);
}
