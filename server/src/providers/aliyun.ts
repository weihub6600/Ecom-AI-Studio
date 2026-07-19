import type { GenerateImageRequest, GenerateImageResult, ImageProviderAdapter } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../utils/http.js";
import { toAliyunSize } from "../utils/image.js";

interface AliyunResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ type?: string; image?: string }>;
      };
    }>;
  };
  request_id?: string;
}

export class AliyunAdapter implements ImageProviderAdapter {
  readonly provider = "aliyun" as const;

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("尚未配置 DASHSCOPE_API_KEY");

    const startedAt = Date.now();
    const url = process.env.DASHSCOPE_IMAGE_URL || "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
    const isPro = request.model.includes("pro");
    const content = [
      ...request.images.map((image) => ({ image: image.dataUrl })),
      { text: request.prompt }
    ];

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        input: {
          messages: [{ role: "user", content }]
        },
        parameters: {
          size: toAliyunSize(request.aspectRatio, request.quality, isPro),
          n: request.count,
          watermark: false,
          seed: request.seed
        }
      })
    });

    const body = (await readJsonResponse(response)) as AliyunResponse;
    const images = (body.output?.choices || []).flatMap((choice) =>
      (choice.message?.content || [])
        .filter((item) => item.image)
        .map((item) => ({ url: item.image as string, mimeType: "image/png" }))
    );

    if (images.length === 0) throw new Error("通义万相未返回可用图片");

    return {
      provider: this.provider,
      model: request.model,
      images,
      durationMs: Date.now() - startedAt,
      requestId: body.request_id
    };
  }
}
