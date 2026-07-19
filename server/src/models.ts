import type { ModelCapability } from "./types.js";

const allSizes: ModelCapability["sizes"] = ["auto", "1024x1024", "1024x1536", "1536x1024", "960x1280", "1280x960"];

function configured(): boolean {
  return Boolean(process.env.LINGKE_API_KEY);
}

export function getModels(): ModelCapability[] {
  return [
    {
      id: process.env.LINGKE_IMAGE_MODEL || "gpt-image-2",
      provider: "lingke",
      providerName: "百嘉瑞AI",
      name: "GPT Image 2",
      description: "百嘉瑞AI 异步图像生成模型，支持文生图与商品参考图生成",
      configured: configured(),
      supportsReferenceImages: true,
      maxReferenceImages: 4,
      supportsNegativePrompt: false,
      supportsSeed: false,
      sizes: allSizes,
      qualities: ["auto", "high", "medium", "low"],
      maxOutputImages: 4,
      asynchronous: true
    }
  ];
}

export function findModel(model: string): ModelCapability | undefined {
  return getModels().find((item) => item.id === model);
}
