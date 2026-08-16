import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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


const SAFE_EXTERNAL_MAX_REDIRECTS = 5;

export async function fetchSafeExternalWithTimeout(
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

  let currentUrl = url;
  let currentInit: RequestInit = {
    ...init
  };

  try {
    for (
      let redirectCount = 0;
      redirectCount <= SAFE_EXTERNAL_MAX_REDIRECTS;
      redirectCount += 1
    ) {
      const parsed =
        await assertSafeExternalHttpUrl(
          currentUrl
        );

      const response = await fetch(
        parsed,
        {
          ...currentInit,
          redirect: "manual",
          signal: controller.signal
        }
      );

      if (
        response.status < 300 ||
        response.status >= 400
      ) {
        return response;
      }

      if (
        redirectCount >=
        SAFE_EXTERNAL_MAX_REDIRECTS
      ) {
        throw new ProviderHttpError(
          "????????????",
          502
        );
      }

      const location =
        response.headers.get("location");

      if (!location) {
        throw new ProviderHttpError(
          "?????????????",
          502
        );
      }

      const nextUrl =
        new URL(location, parsed);

      await assertSafeExternalHttpUrl(
        nextUrl.toString()
      );

      /*
       * ??? Provider ?? Authorization/API Key
       * ?????????????
       */
      if (
        nextUrl.origin !== parsed.origin
      ) {
        throw new ProviderHttpError(
          "???????????????????",
          502
        );
      }

      currentInit =
        redirectedRequestInit(
          currentInit,
          response.status
        );

      currentUrl =
        nextUrl.toString();
    }

    throw new ProviderHttpError(
      "????????????",
      502
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ProviderHttpError(
        "????????????",
        504
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertSafeExternalHttpUrl(
  rawUrl: string
): Promise<URL> {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderHttpError(
      "????????????",
      400
    );
  }

  if (
    parsed.protocol !== "https:" &&
    parsed.protocol !== "http:"
  ) {
    throw new ProviderHttpError(
      "?????????? HTTP ? HTTPS",
      400
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    parsed.protocol !== "https:"
  ) {
    throw new ProviderHttpError(
      "??????????????? HTTPS",
      400
    );
  }

  if (parsed.username || parsed.password) {
    throw new ProviderHttpError(
      "????????????????",
      400
    );
  }

  /*
   * ????????????? Provider?
   * production ???????????????
   */
  const allowPrivate =
    process.env.NODE_ENV !== "production" &&
    process.env
      .CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORK ===
      "true";

  if (allowPrivate) {
    return parsed;
  }

  const hostname =
    parsed.hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();

  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "local"
  ) {
    throw new ProviderHttpError(
      "?????????????????",
      400
    );
  }

  if (isIP(hostname)) {
    if (isUnsafeNetworkAddress(hostname)) {
      throw new ProviderHttpError(
        "?????????????????????",
        400
      );
    }

    return parsed;
  }

  let addresses:
    Array<{
      address: string;
      family: number;
    }>;

  try {
    addresses =
      await lookup(
        hostname,
        {
          all: true,
          verbatim: true
        }
      );
  } catch {
    throw new ProviderHttpError(
      "???????????",
      502
    );
  }

  if (
    addresses.length === 0 ||
    addresses.some(
      (item) =>
        isUnsafeNetworkAddress(
          item.address
        )
    )
  ) {
    throw new ProviderHttpError(
      "?????????????????????????",
      400
    );
  }

  return parsed;
}

function redirectedRequestInit(
  init: RequestInit,
  status: number
): RequestInit {
  const method =
    String(init.method || "GET")
      .toUpperCase();

  const switchToGet =
    (
      status === 303 &&
      method !== "HEAD"
    ) ||
    (
      (status === 301 ||
       status === 302) &&
      method === "POST"
    );

  if (!switchToGet) {
    return {
      ...init
    };
  }

  const headers =
    new Headers(init.headers);

  headers.delete("content-length");
  headers.delete("content-type");

  return {
    ...init,
    method: "GET",
    body: undefined,
    headers
  };
}

function isUnsafeNetworkAddress(
  address: string
): boolean {
  let normalized =
    address
      .toLowerCase()
      .replace(/^\[|\]$/g, "");

  const zoneIndex =
    normalized.indexOf("%");

  if (zoneIndex >= 0) {
    normalized =
      normalized.slice(0, zoneIndex);
  }

  if (
    normalized.startsWith("::ffff:")
  ) {
    return isUnsafeNetworkAddress(
      normalized.slice(7)
    );
  }

  const version = isIP(normalized);

  if (version === 4) {
    const parts =
      normalized
        .split(".")
        .map(Number);

    const first = parts[0];
    const second = parts[1];

    if (
      first === undefined ||
      second === undefined
    ) {
      return true;
    }

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||

      // Carrier-grade NAT 100.64.0.0/10
      (
        first === 100 &&
        second >= 64 &&
        second <= 127
      ) ||

      (
        first === 169 &&
        second === 254
      ) ||

      (
        first === 172 &&
        second >= 16 &&
        second <= 31
      ) ||

      (
        first === 192 &&
        second === 168
      ) ||

      // IETF protocol assignments
      (
        first === 192 &&
        second === 0
      ) ||

      // Benchmark network
      (
        first === 198 &&
        (
          second === 18 ||
          second === 19
        )
      ) ||

      // Documentation ranges
      (
        first === 192 &&
        second === 0 &&
        parts[2] === 2
      ) ||
      (
        first === 198 &&
        second === 51 &&
        parts[2] === 100
      ) ||
      (
        first === 203 &&
        second === 0 &&
        parts[2] === 113
      ) ||

      first >= 224
    );
  }

  if (version === 6) {
    if (
      normalized === "::" ||
      normalized === "::1"
    ) {
      return true;
    }

    // ??? IPv6 ???? 2000::/3
    const firstGroup =
      Number.parseInt(
        normalized.split(":")[0] || "0",
        16
      );

    if (
      !Number.isFinite(firstGroup) ||
      firstGroup < 0x2000 ||
      firstGroup > 0x3fff
    ) {
      return true;
    }

    // Documentation 2001:db8::/32
    if (
      normalized.startsWith("2001:db8:")
    ) {
      return true;
    }

    return false;
  }

  return true;
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
