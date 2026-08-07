import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProviderAdapter,
  InputImage
} from "../types.js";
import {
  fetchWithTimeout,
  ProviderHttpError,
  readJsonResponse
} from "../utils/http.js";
import {
  getBuiltInModelRuntimeConfig,
  getBuiltInProviderRuntimeConfig
} from "../services/provider-runtime.js";

interface GrsaiResultItem {
  url: string;
}

interface GrsaiResponse {
  id?: string;
  status?: string;
  results?:
    GrsaiResultItem[];
  progress?: number;
  error?: string;
  message?: string;
}

const FALLBACK_MODEL_MAP:
  Record<string, string> = {
    "grsai-gpt-image-2":
      "gpt-image-2",
    "grsai-gpt-image-2-vip":
      "gpt-image-2-vip"
  };

function getConfig() {
  const runtime =
    getBuiltInProviderRuntimeConfig(
      "grsai"
    );

  const apiKey =
    runtime
      ? runtime.apiKey
      : (
          process.env
            .GRSAI_API_KEY ||
          ""
        );

  if (!apiKey) {
    throw new Error(
      "GRSAI 尚未配置 API Key，或保存密钥与当前 API_PROVIDER_SECRET 不匹配"
    );
  }

  if (
    runtime &&
    !runtime.enabled
  ) {
    throw new Error(
      "GRSAI 已由站长停用"
    );
  }

  return {
    displayName:
      runtime?.displayName ||
      "GPT",
    apiKey,
    baseUrl:
      (
        runtime?.baseUrl ||
        process.env
          .GRSAI_BASE_URL ||
        "https://grsai.dakka.com.cn"
      ).replace(
        /\/+$/,
        ""
      ),
    endpoint:
      runtime
        ?.generateEndpoint ||
      process.env
        .GRSAI_IMAGE_ENDPOINT ||
      "/v1/api/generate",
    timeoutMs:
      runtime?.timeoutMs ||
      300_000,
    defaultModel:
      process.env
        .GRSAI_DEFAULT_MODEL ||
      "gpt-image-2"
  };
}

function buildUrl(
  baseUrl: string,
  endpoint: string
): string {
  return (
    `${baseUrl}/` +
    endpoint.replace(
      /^\//,
      ""
    )
  );
}

function normalizeReferenceImages(
  images: InputImage[]
): string[] {
  return images.map(
    (image) => {
      const value =
        image.dataUrl.trim();

      if (
        value.startsWith(
          "data:image/"
        )
      ) {
        return value;
      }

      try {
        const url =
          new URL(value);

        if (
          url.protocol !==
            "http:" &&
          url.protocol !==
            "https:"
        ) {
          throw new Error(
            "unsupported protocol"
          );
        }

        return url.toString();
      }
      catch {
        throw new ProviderHttpError(
          `参考图 ${image.name} 不是有效的图片 URL 或 data URL`,
          400
        );
      }
    }
  );
}

function isRecord(
  value: unknown
):
  value is
    Record<
      string,
      unknown
    > {
  return (
    typeof value ===
      "object" &&
    value !== null
  );
}

function toResponse(
  value: unknown
):
  GrsaiResponse {
  if (!isRecord(value)) {
    return {};
  }

  const results =
    Array.isArray(
      value.results
    )
      ? value.results
          .flatMap(
            (item) => {
              if (
                !isRecord(item) ||
                typeof item.url !==
                  "string" ||
                !item.url.trim()
              ) {
                return [];
              }

              return [
                {
                  url:
                    item.url.trim()
                }
              ];
            }
          )
      : undefined;

  return {
    id:
      typeof value.id ===
        "string"
        ? value.id
        : undefined,
    status:
      typeof value.status ===
        "string"
        ? value.status
        : undefined,
    results,
    progress:
      typeof value.progress ===
        "number"
        ? value.progress
        : undefined,
    error:
      typeof value.error ===
        "string"
        ? value.error
        : undefined,
    message:
      typeof value.message ===
        "string"
        ? value.message
        : undefined
  };
}

function apiModelFor(
  requestModel: string,
  fallback: string
): string {
  return (
    getBuiltInModelRuntimeConfig(
      "grsai",
      requestModel
    )?.apiModelId ||
    FALLBACK_MODEL_MAP[
      requestModel
    ] ||
    fallback
  );
}

export class GrsaiAdapter
  implements ImageProviderAdapter {
  readonly provider =
    "grsai" as const;

  async generate(
    request:
      GenerateImageRequest
  ):
    Promise<
      GenerateImageResult
    > {
    const config =
      getConfig();

    const startedAt =
      Date.now();

    const apiModel =
      apiModelFor(
        request.model,
        config.defaultModel
      );

    const response =
      await fetchWithTimeout(
        buildUrl(
          config.baseUrl,
          config.endpoint
        ),
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${config.apiKey}`,
            "Content-Type":
              "application/json",
            Accept:
              "application/json"
          },
          body:
            JSON.stringify({
              model:
                apiModel,
              prompt:
                request.prompt,
              images:
                normalizeReferenceImages(
                  request.images
                ),
              aspectRatio:
                request.size,
              replyType:
                "json",
              negativePrompt:
                request.negativePrompt,
              seed:
                request.seed
            })
        },
        config.timeoutMs
      );

    const body =
      toResponse(
        await readJsonResponse(
          response
        )
      );

    const status =
      body.status
        ?.toLowerCase();

    const safeDetails = {
      id:
        body.id,
      status:
        body.status,
      progress:
        body.progress,
      error:
        body.error ||
        body.message
    };

    if (
      status === "failed" ||
      status === "violation"
    ) {
      throw new ProviderHttpError(
        body.error ||
        body.message ||
        `${config.displayName} 任务状态为 ${status}`,
        502,
        safeDetails
      );
    }

    if (
      status === "running"
    ) {
      throw new ProviderHttpError(
        `${config.displayName} 同步请求尚未完成，请稍后重试`,
        502,
        safeDetails
      );
    }

    if (
      status !== "succeeded"
    ) {
      throw new ProviderHttpError(
        `${config.displayName} 返回了无法识别的任务状态：${body.status || "未知"}`,
        502,
        safeDetails
      );
    }

    const images =
      (
        body.results ||
        []
      ).map(
        (item) => ({
          url:
            item.url
        })
      );

    if (
      images.length === 0
    ) {
      throw new ProviderHttpError(
        `${config.displayName} 显示生成成功，但没有返回图片地址`,
        502,
        safeDetails
      );
    }

    return {
      provider:
        this.provider,
      model:
        request.model,
      images,
      durationMs:
        Date.now() -
        startedAt,
      requestId:
        body.id,
      taskId:
        body.id,
      status:
        "completed",
      progress:
        typeof body.progress ===
          "number"
          ? `${body.progress}%`
          : "100%"
    };
  }
}
