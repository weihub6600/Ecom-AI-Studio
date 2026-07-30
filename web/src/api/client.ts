export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    status: number,
    message: string,
    code?: string
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | undefined;
let csrfPromise:
  Promise<string> | undefined;

export async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const method =
    (options?.method || "GET")
      .toUpperCase();

  let response = await performFetch(
    url,
    options,
    method
  );

  let data = await readResponse<T>(response);

  if (
    response.status === 403 &&
    data.error?.code ===
      "CSRF_VALIDATION_FAILED" &&
    isUnsafeMethod(method)
  ) {
    csrfToken = undefined;
    csrfPromise = undefined;

    response = await performFetch(
      url,
      options,
      method
    );

    data = await readResponse<T>(response);
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.message ||
        `请求失败（HTTP ${response.status}）`,
      data.error?.code
    );
  }

  if (
    /^\/api\/auth\/(?:login|register|logout)(?:\?|$)/
      .test(url)
  ) {
    csrfToken = undefined;
    csrfPromise = undefined;
  }

  return data as T;
}

export function jsonRequest(
  body: unknown,
  method = "POST"
): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

async function performFetch(
  url: string,
  options: RequestInit | undefined,
  method: string
): Promise<Response> {
  const headers = new Headers(
    options?.headers
  );

  if (isUnsafeMethod(method)) {
    headers.set(
      "X-CSRF-Token",
      await getCsrfToken()
    );
  }

  try {
    return await fetch(url, {
      ...options,
      method,
      headers,
      credentials:
        options?.credentials ||
        "same-origin"
    });
  } catch {
    throw new ApiError(
      0,
      "无法连接服务器，请确认服务端已经启动"
    );
  }
}

async function getCsrfToken():
  Promise<string> {
  if (csrfToken) return csrfToken;

  if (!csrfPromise) {
    csrfPromise = fetchCsrfToken()
      .then((token) => {
        csrfToken = token;
        return token;
      })
      .finally(() => {
        csrfPromise = undefined;
      });
  }

  return csrfPromise;
}

async function fetchCsrfToken():
  Promise<string> {
  let response: Response;

  try {
    response = await fetch(
      "/api/security/csrf",
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      }
    );
  } catch {
    throw new ApiError(
      0,
      "无法获取安全请求令牌"
    );
  }

  const data = await response.json()
    .catch(() => ({})) as {
      csrfToken?: string;
      error?: {
        code?: string;
        message?: string;
      };
    };

  if (
    !response.ok ||
    typeof data.csrfToken !== "string" ||
    !data.csrfToken
  ) {
    throw new ApiError(
      response.status,
      data.error?.message ||
        "无法获取安全请求令牌",
      data.error?.code
    );
  }

  return data.csrfToken;
}

async function readResponse<T>(
  response: Response
): Promise<T & ApiErrorPayload> {
  return response.json()
    .catch(() => ({})) as
      Promise<T & ApiErrorPayload>;
}

function isUnsafeMethod(
  method: string
): boolean {
  return method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS";
}
