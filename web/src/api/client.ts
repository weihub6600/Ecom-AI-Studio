export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new ApiError(0, "无法连接服务器，请确认服务端已经启动");
  }

  const data = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.message || `请求失败（HTTP ${response.status}）`,
      data.error?.code
    );
  }
  return data;
}

export function jsonRequest(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
