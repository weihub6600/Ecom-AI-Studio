import type {
  ModelCapability
} from "./types.js";
import {
  getBuiltInProviderRuntimeConfig,
  type BuiltInProviderId
} from "./services/provider-runtime.js";

const lingkeSizes:
  ModelCapability["sizes"] = [
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "960x1280",
    "1280x960"
  ];

const grsaiStandardSizes:
  ModelCapability["sizes"] = [
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "1090x1443",
    "1443x1090"
  ];

const grsaiVipSizes:
  ModelCapability["sizes"] = [
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "864x1152",
    "1152x864"
  ];

const nanoBanana4kSizes:
  ModelCapability["sizes"] = [
    "auto",
    "4096x4096",
    "2720x4080",
    "4080x2720",
    "3072x4096",
    "4096x3072"
  ];

interface ModelDefinition {
  id: string;
  provider: BuiltInProviderId;
  fallbackProviderName: string;
  name: string;
  description: string;
  sizes: string[];
  maxOutputImages: number;
  asynchronous: boolean;
}

const definitions:
  ModelDefinition[] = [
    {
      id:
        process.env
          .LINGKE_IMAGE_MODEL ||
        "gpt-image-2",
      provider: "lingke",
      fallbackProviderName:
        "ZHE AI",
      name:
        "GPT Image 2",
      description:
        "ZHE AI 异步图像生成模型，支持文生图与商品参考图生成",
      sizes:
        lingkeSizes,
      maxOutputImages: 4,
      asynchronous: true
    },
    {
      id:
        "grsai-gpt-image-2",
      provider: "grsai",
      fallbackProviderName:
        "GPT",
      name:
        "GPT Image 2",
      description:
        "GRSAI 同步图像生成模型，支持文生图与参考图生成",
      sizes:
        grsaiStandardSizes,
      maxOutputImages: 1,
      asynchronous: false
    },
    {
      id:
        "grsai-gpt-image-2-vip",
      provider: "grsai",
      fallbackProviderName:
        "GPT",
      name:
        "GPT Image 2 VIP",
      description:
        "GRSAI 1K–4K 高分辨率同步图像生成模型",
      sizes:
        grsaiVipSizes,
      maxOutputImages: 1,
      asynchronous: false
    },
    {
      id:
        "nanobanana-nano-banana-pro",
      provider:
        "nanobanana",
      fallbackProviderName:
        "Nano Banana",
      name:
        "Nano Banana Pro",
      description:
        "Nano Banana Pro 4K 图像生成模型，支持文生图与商品参考图生成",
      sizes:
        nanoBanana4kSizes,
      maxOutputImages: 1,
      asynchronous: false
    },
    {
      id:
        "nanobanana-nano-banana-2",
      provider:
        "nanobanana",
      fallbackProviderName:
        "Nano Banana",
      name:
        "Nano Banana 2",
      description:
        "Nano Banana 2 4K 图像生成模型，支持文生图与商品参考图生成",
      sizes:
        nanoBanana4kSizes,
      maxOutputImages: 1,
      asynchronous: false
    }
  ];

export function getModels():
  ModelCapability[] {
  return definitions.map(
    (definition) => {
      const provider =
        getBuiltInProviderRuntimeConfig(
          definition.provider
        );

      return {
        id:
          definition.id,
        provider:
          definition.provider,
        providerName:
          provider
            ?.displayName ||
          definition
            .fallbackProviderName,
        name:
          definition.name,
        description:
          definition.description,
        configured:
          Boolean(
            provider?.apiKey ||
            fallbackApiKey(
              definition.provider
            )
          ),
        supportsReferenceImages:
          true,
        maxReferenceImages: 4,
        supportsNegativePrompt:
          false,
        supportsSeed:
          false,
        sizes:
          definition.sizes,
        qualities: [],
        maxOutputImages:
          definition
            .maxOutputImages,
        asynchronous:
          definition
            .asynchronous
      };
    }
  );
}

export function findModel(
  model: string
):
  ModelCapability |
  undefined {
  return getModels().find(
    (item) =>
      item.id === model
  );
}

export function validateModelSize(
  model: ModelCapability,
  size: string
):
  string |
  undefined {
  if (
    !model.sizes.includes(size)
  ) {
    return `模型 ${model.name} 不支持输出尺寸 ${size}`;
  }

  if (
    model.id !==
      "grsai-gpt-image-2-vip" ||
    size === "auto"
  ) {
    return undefined;
  }

  const match =
    /^(\d+)x(\d+)$/.exec(
      size
    );

  if (!match) {
    return "GPT Image 2 VIP 仅支持 auto 或像素尺寸";
  }

  const width =
    Number(match[1]);

  const height =
    Number(match[2]);

  const longest =
    Math.max(
      width,
      height
    );

  const shortest =
    Math.min(
      width,
      height
    );

  const pixels =
    width * height;

  if (longest > 3840) {
    return "GPT Image 2 VIP 的最大边不能超过 3840px";
  }

  if (
    width % 16 !== 0 ||
    height % 16 !== 0
  ) {
    return "GPT Image 2 VIP 的宽高都必须是 16 的倍数";
  }

  if (
    longest / shortest > 3
  ) {
    return "GPT Image 2 VIP 的长短边比例不能超过 3:1";
  }

  if (
    pixels < 655_360
  ) {
    return "GPT Image 2 VIP 的总像素数不能少于 655,360";
  }

  if (
    pixels > 8_294_400
  ) {
    return "GPT Image 2 VIP 的总像素数不能超过 8,294,400";
  }

  return undefined;
}

function fallbackApiKey(
  provider: BuiltInProviderId
): string {
  if (
    provider === "lingke"
  ) {
    return (
      process.env
        .LINGKE_API_KEY ||
      ""
    );
  }

  if (
    provider === "grsai"
  ) {
    return (
      process.env
        .GRSAI_API_KEY ||
      ""
    );
  }

  return (
    process.env
      .NANO_BANANA_API_KEY ||
    process.env
      .GRSAI_API_KEY ||
    ""
  );
}
