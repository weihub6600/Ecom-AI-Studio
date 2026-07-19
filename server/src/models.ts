import type { ModelCapability } from "./types.js";

const lingkeSizes: ModelCapability["sizes"] = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "960x1280",
  "1280x960"
];

// GRSAI gpt-image-2 文档明确支持的 6 个常用规格。
const grsaiStandardSizes: ModelCapability["sizes"] = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1090x1443",
  "1443x1090"
];

// GRSAI gpt-image-2-vip 文档明确支持的 6 个常用规格。
const grsaiVipSizes: ModelCapability["sizes"] = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "864x1152",
  "1152x864"
];

function lingkeConfigured(): boolean {
  return Boolean(process.env.LINGKE_API_KEY);
}

function grsaiConfigured(): boolean {
  return Boolean(process.env.GRSAI_API_KEY);
}

export function getModels(): ModelCapability[] {
  return [
    {
      id: process.env.LINGKE_IMAGE_MODEL || "gpt-image-2",
      provider: "lingke",
      providerName: "百嘉瑞AI",
      name: "GPT Image 2",
      description: "百嘉瑞AI 异步图像生成模型，支持文生图与商品参考图生成",
      configured: lingkeConfigured(),
      supportsReferenceImages: true,
      maxReferenceImages: 4,
      supportsNegativePrompt: false,
      supportsSeed: false,
      sizes: lingkeSizes,
      qualities: [],
      maxOutputImages: 4,
      asynchronous: true
    },
    {
      id: "grsai-gpt-image-2",
      provider: "grsai",
      providerName: "GRSAI",
      name: "GPT Image 2",
      description: "GRSAI 同步图像生成模型，支持文生图与参考图生成",
      configured: grsaiConfigured(),
      supportsReferenceImages: true,
      maxReferenceImages: 4,
      supportsNegativePrompt: false,
      supportsSeed: false,
      sizes: grsaiStandardSizes,
      qualities: [],
      maxOutputImages: 1,
      asynchronous: false
    },
    {
      id: "grsai-gpt-image-2-vip",
      provider: "grsai",
      providerName: "GRSAI",
      name: "GPT Image 2 VIP",
      description: "GRSAI 1K–4K 高分辨率同步图像生成模型",
      configured: grsaiConfigured(),
      supportsReferenceImages: true,
      maxReferenceImages: 4,
      supportsNegativePrompt: false,
      supportsSeed: false,
      sizes: grsaiVipSizes,
      qualities: [],
      maxOutputImages: 1,
      asynchronous: false
    }
  ];
}

export function findModel(model: string): ModelCapability | undefined {
  return getModels().find((item) => item.id === model);
}

export function validateModelSize(model: ModelCapability, size: string): string | undefined {
  if (!model.sizes.includes(size)) {
    return `模型 ${model.name} 不支持输出尺寸 ${size}`;
  }

  if (model.id !== "grsai-gpt-image-2-vip" || size === "auto") return undefined;

  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return "GPT Image 2 VIP 仅支持 auto 或像素尺寸";

  const width = Number(match[1]);
  const height = Number(match[2]);
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  const pixels = width * height;

  if (longest > 3840) return "GPT Image 2 VIP 的最大边不能超过 3840px";
  if (width % 16 !== 0 || height % 16 !== 0) return "GPT Image 2 VIP 的宽高都必须是 16 的倍数";
  if (longest / shortest > 3) return "GPT Image 2 VIP 的长短边比例不能超过 3:1";
  if (pixels < 655_360) return "GPT Image 2 VIP 的总像素数不能少于 655,360";
  if (pixels > 8_294_400) return "GPT Image 2 VIP 的总像素数不能超过 8,294,400";

  return undefined;
}
