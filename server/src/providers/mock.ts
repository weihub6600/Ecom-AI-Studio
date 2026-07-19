import type { GenerateImageRequest, GenerateImageResult, ImageProviderAdapter } from "../types.js";
import { getDimensions } from "../utils/image.js";

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      "\"": "&quot;"
    };
    return entities[character] || character;
  });
}

function svgDataUrl(request: GenerateImageRequest, index: number): string {
  const { width, height } = getDimensions(request.aspectRatio);
  const prompt = escapeXml(request.prompt.slice(0, 110));
  const hasImage = request.images.length > 0;
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f3f5ff"/>
        <stop offset="0.52" stop-color="#ece8ff"/>
        <stop offset="1" stop-color="#dff7ff"/>
      </linearGradient>
      <linearGradient id="product" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#d8dcff"/>
      </linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="26" stdDeviation="24" flood-opacity="0.18"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="${width * 0.82}" cy="${height * 0.18}" r="${Math.min(width, height) * 0.22}" fill="#ffffff" opacity="0.55"/>
    <circle cx="${width * 0.12}" cy="${height * 0.78}" r="${Math.min(width, height) * 0.28}" fill="#b9f2ff" opacity="0.42"/>
    <rect x="${width * 0.2}" y="${height * 0.19}" width="${width * 0.6}" height="${height * 0.55}" rx="${Math.min(width, height) * 0.045}" fill="url(#product)" stroke="#ffffff" stroke-width="5" filter="url(#shadow)"/>
    <rect x="${width * 0.28}" y="${height * 0.29}" width="${width * 0.44}" height="${height * 0.25}" rx="24" fill="#101325"/>
    <text x="50%" y="${height * 0.405}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="${Math.max(28, width * 0.055)}">ECOM AI</text>
    <text x="50%" y="${height * 0.47}" text-anchor="middle" fill="#b9c3ff" font-family="Arial, sans-serif" font-size="${Math.max(18, width * 0.025)}">MOCK PRODUCT ${index + 1}</text>
    <text x="50%" y="${height * 0.82}" text-anchor="middle" fill="#17192b" font-family="Arial, sans-serif" font-size="${Math.max(18, width * 0.026)}">${hasImage ? `已接收 ${request.images.length} 张参考图` : "文生图测试模式"}</text>
    <foreignObject x="${width * 0.12}" y="${height * 0.855}" width="${width * 0.76}" height="${height * 0.1}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font: ${Math.max(16, width * 0.02)}px Arial; color:#50536c; text-align:center; line-height:1.4;">${prompt}</div>
    </foreignObject>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class MockAdapter implements ImageProviderAdapter {
  readonly provider = "mock" as const;

  async generate(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const dimensions = getDimensions(request.aspectRatio);

    return {
      provider: this.provider,
      model: request.model,
      images: Array.from({ length: request.count }, (_, index) => ({
        url: svgDataUrl(request, index),
        width: dimensions.width,
        height: dimensions.height,
        mimeType: "image/svg+xml"
      })),
      durationMs: Date.now() - startedAt,
      requestId: `mock_${Date.now()}`
    };
  }
}
