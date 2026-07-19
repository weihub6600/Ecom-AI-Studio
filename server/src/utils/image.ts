import type { AspectRatio, ImageQuality } from "../types.js";

const dimensions: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "3:4": { width: 864, height: 1152 },
  "4:3": { width: 1152, height: 864 },
  "4:5": { width: 896, height: 1120 },
  "9:16": { width: 768, height: 1365 },
  "16:9": { width: 1365, height: 768 }
};

export function getDimensions(ratio: AspectRatio): { width: number; height: number } {
  return dimensions[ratio];
}

export function toOpenAISize(ratio: AspectRatio): "1024x1024" | "1024x1536" | "1536x1024" {
  if (ratio === "1:1") return "1024x1024";
  if (["3:4", "4:5", "9:16"].includes(ratio)) return "1024x1536";
  return "1536x1024";
}

export function toOpenAIQuality(quality: ImageQuality): "low" | "medium" | "high" {
  if (quality === "draft") return "low";
  if (quality === "high") return "high";
  return "medium";
}

export function toAliyunSize(ratio: AspectRatio, quality: ImageQuality, isPro: boolean): string {
  if (ratio === "1:1") {
    if (quality === "draft") return "1K";
    if (quality === "high" && isPro) return "2K";
    return "2K";
  }

  const { width, height } = getDimensions(ratio);
  const scale = quality === "high" ? 1.5 : quality === "draft" ? 0.9 : 1.15;
  const targetWidth = Math.round((width * scale) / 8) * 8;
  const targetHeight = Math.round((height * scale) / 8) * 8;
  return `${targetWidth}*${targetHeight}`;
}

export function toSeedreamSize(ratio: AspectRatio, quality: ImageQuality): string {
  const { width, height } = getDimensions(ratio);
  const scale = quality === "high" ? 1.65 : quality === "draft" ? 0.85 : 1.2;
  const targetWidth = Math.round((width * scale) / 8) * 8;
  const targetHeight = Math.round((height * scale) / 8) * 8;
  return `${targetWidth}x${targetHeight}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match?.[1] || !match[2]) {
    throw new Error("参考图 Base64 格式无效");
  }
  const bytes = Buffer.from(match[2], "base64");
  return new Blob([bytes], { type: match[1] });
}
