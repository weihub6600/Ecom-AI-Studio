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
  timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 180_000)
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderHttpError("模型请求超时，请稍后重试", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let body: any;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      body?.error_msg ||
      `模型接口返回 HTTP ${response.status}`;
    throw new ProviderHttpError(message, response.status, body);
  }

  return body;
}
