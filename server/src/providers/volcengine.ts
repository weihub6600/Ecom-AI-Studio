import type { GenerateImageRequest, GenerateImageResult, ImageProviderAdapter } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../utils/http.js";
import { toSeedreamSize } from "../utils/image.js";

interface ArkResponse {
  data?: Array<{ url?: string; b64_json?: string; size?: string }>;
  created?: number;
}

export class VolcengineAdapter implements ImageProviderAdapter {
  readonly provider = "volcengine" as const;

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) throw new Error("尚未配置 ARK_API_KEY");

    const startedAt = Date.now();
    const url = process.env.ARK_IMAGE_URL || "https://ark.cn-beijing.volces.com/api/v3/images/generations";
    const imageInput = request.images.map((image) => image.dataUrl);

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        image: imageInput.length === 0 ? undefined : imageInput.length === 1 ? imageInput[0] : imageInput,
        size: toSeedreamSize(request.aspectRatio, request.quality),
        seed: request.seed,
        sequential_image_generation: request.count > 1 ? "auto" : "disabled",
        sequential_image_generation_options: request.count > 1 ? { max_images: request.count } : undefined,
        stream: false,
        response_format: "url",
        watermark: false
      })
    });

    const body = (await readJsonResponse(response)) as ArkResponse;
    const images = (body.data || []).flatMap((item) => {
      if (item.url) return [{ url: item.url }];
      if (item.b64_json) return [{ url: `data:image/jpeg;base64,${item.b64_json}`, mimeType: "image/jpeg" }];
      return [];
    });

    if (images.length === 0) throw new Error("Seedream 未返回可用图片");

    return {
      provider: this.provider,
      model: request.model,
      images,
      durationMs: Date.now() - startedAt,
      requestId: body.created ? String(body.created) : undefined
    };
  }
}
