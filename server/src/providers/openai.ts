import type { GenerateImageRequest, GenerateImageResult, ImageProviderAdapter } from "../types.js";
import { fetchWithTimeout, readJsonResponse } from "../utils/http.js";
import { dataUrlToBlob, toOpenAIQuality, toOpenAISize } from "../utils/image.js";

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

export class OpenAIAdapter implements ImageProviderAdapter {
  readonly provider = "openai" as const;

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("尚未配置 OPENAI_API_KEY");

    const startedAt = Date.now();
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    let response: Response;

    if (request.images.length > 0) {
      const form = new FormData();
      form.set("model", request.model);
      form.set("prompt", request.prompt);
      form.set("size", toOpenAISize(request.aspectRatio));
      form.set("quality", toOpenAIQuality(request.quality));
      form.set("n", String(request.count));
      form.set("output_format", "png");
      form.set("input_fidelity", "high");

      request.images.forEach((image, index) => {
        const extension = image.mimeType.split("/")[1] || "png";
        form.append("image[]", dataUrlToBlob(image.dataUrl), image.name || `reference-${index}.${extension}`);
      });

      response = await fetchWithTimeout(`${baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
      });
    } else {
      response = await fetchWithTimeout(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          size: toOpenAISize(request.aspectRatio),
          quality: toOpenAIQuality(request.quality),
          n: request.count,
          output_format: "png"
        })
      });
    }

    const body = (await readJsonResponse(response)) as OpenAIImageResponse;
    const images = (body.data || []).flatMap((item) => {
      if (item.b64_json) return [{ url: `data:image/png;base64,${item.b64_json}`, mimeType: "image/png" }];
      if (item.url) return [{ url: item.url }];
      return [];
    });

    if (images.length === 0) throw new Error("OpenAI 未返回可用图片");

    return {
      provider: this.provider,
      model: request.model,
      images,
      durationMs: Date.now() - startedAt
    };
  }
}
