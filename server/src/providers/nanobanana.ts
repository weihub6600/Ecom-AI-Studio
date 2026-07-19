import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProviderAdapter,
  InputImage
} from "../types.js";
import { fetchWithTimeout, ProviderHttpError, readJsonResponse } from "../utils/http.js";

interface NanoBananaResultItem {
  url: string;
}

interface NanoBananaResponse {
  id?: string;
  status?: string;
  results?: NanoBananaResultItem[];
  progress?: number;
  error?: string;
  message?: string;
}

const MODEL_MAP: Record<string, "nano-banana-pro" | "nano-banana-2"> = {
  "nanobanana-nano-banana-pro": "nano-banana-pro",
  "nanobanana-nano-banana-2": "nano-banana-2"
};

const ASPECT_RATIO_MAP: Record<string, string> = {
  auto: "auto",
  "4096x4096": "1:1",
  "2720x4080": "2:3",
  "4080x2720": "3:2",
  "3072x4096": "3:4",
  "4096x3072": "4:3"
};

function getConfig() {
  const apiKey = process.env.NANO_BANANA_API_KEY || process.env.GRSAI_API_KEY;
  if (!apiKey) {
    throw new Error("尚未配置 NANO_BANANA_API_KEY，也没有可复用的 GRSAI_API_KEY");
  }

  const timeout = Number(process.env.NANO_BANANA_TIMEOUT_MS || 300_000);
  const configuredImageSize = String(process.env.NANO_BANANA_IMAGE_SIZE || "4K").toUpperCase();
  const imageSize = configuredImageSize === "1K" || configuredImageSize === "2K" || configuredImageSize === "4K"
    ? configuredImageSize
    : "4K";

  return {
    apiKey,
    baseUrl: (
      process.env.NANO_BANANA_BASE_URL ||
      process.env.GRSAI_BASE_URL ||
      "https://grsai.dakka.com.cn"
    ).replace(/\/$/, ""),
    endpoint:
      process.env.NANO_BANANA_IMAGE_ENDPOINT ||
      process.env.GRSAI_IMAGE_ENDPOINT ||
      "/v1/api/generate",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 300_000,
    imageSize
  };
}

function buildUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl}/${endpoint.replace(/^\//, "")}`;
}

function normalizeReferenceImages(images: InputImage[]): string[] {
  return images.map((image) => {
    const value = image.dataUrl.trim();
    if (value.startsWith("data:image/")) return value;

    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      return url.toString();
    } catch {
      throw new ProviderHttpError(
        `参考图 ${image.name} 不是有效的图片 URL 或 data URL`,
        400
      );
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toResponse(value: unknown): NanoBananaResponse {
  if (!isRecord(value)) return {};

  const results = Array.isArray(value.results)
    ? value.results.flatMap((item) => {
        if (!isRecord(item) || typeof item.url !== "string" || !item.url.trim()) return [];
        return [{ url: item.url.trim() }];
      })
    : undefined;

  return {
    id: typeof value.id === "string" ? value.id : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    results,
    progress: typeof value.progress === "number" ? value.progress : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
    message: typeof value.message === "string" ? value.message : undefined
  };
}

function apiModelFor(requestModel: string): "nano-banana-pro" | "nano-banana-2" {
  const apiModel = MODEL_MAP[requestModel];
  if (!apiModel) {
    throw new ProviderHttpError(`Nano Banana 不支持模型：${requestModel}`, 400);
  }
  return apiModel;
}

function aspectRatioFor(size: string): string {
  const ratio = ASPECT_RATIO_MAP[size];
  if (!ratio) {
    throw new ProviderHttpError(`Nano Banana 不支持输出尺寸：${size}`, 400);
  }
  return ratio;
}

export class NanobananaAdapter implements ImageProviderAdapter {
  readonly provider = "nanobanana" as const;

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const config = getConfig();
    const startedAt = Date.now();

    const response = await fetchWithTimeout(
      buildUrl(config.baseUrl, config.endpoint),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          model: apiModelFor(request.model),
          prompt: request.prompt,
          images: normalizeReferenceImages(request.images),
          aspectRatio: aspectRatioFor(request.size),
          imageSize: config.imageSize,
          replyType: "json"
        })
      },
      config.timeoutMs
    );

    const body = toResponse(await readJsonResponse(response));
    const status = body.status?.toLowerCase();
    const safeDetails = {
      id: body.id,
      status: body.status,
      progress: body.progress,
      error: body.error || body.message
    };

    if (status === "failed" || status === "violation") {
      throw new ProviderHttpError(
        body.error || body.message || `Nano Banana 任务状态为 ${status}`,
        502,
        safeDetails
      );
    }

    if (status === "running") {
      throw new ProviderHttpError(
        "Nano Banana 同步请求尚未完成，请稍后重试",
        502,
        safeDetails
      );
    }

    if (status !== "succeeded") {
      throw new ProviderHttpError(
        `Nano Banana 返回了无法识别的任务状态：${body.status || "未知"}`,
        502,
        safeDetails
      );
    }

    const images = (body.results || []).map((item) => ({ url: item.url }));
    if (images.length === 0) {
      throw new ProviderHttpError(
        "Nano Banana 显示生成成功，但没有返回图片地址",
        502,
        safeDetails
      );
    }

    return {
      provider: this.provider,
      model: request.model,
      images,
      durationMs: Date.now() - startedAt,
      requestId: body.id,
      taskId: body.id,
      status: "completed",
      progress: typeof body.progress === "number" ? `${body.progress}%` : "100%"
    };
  }
}
