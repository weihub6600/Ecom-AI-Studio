import { z } from "zod";

const imageSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataUrl: z.string().startsWith("data:image/").max(15_000_000)
});

export const generateSchema = z.object({
  provider: z.literal("lingke"),
  model: z.string().min(1).max(160),
  operation: z.enum(["text-to-image", "image-edit"]),
  prompt: z.string().trim().min(2, "提示词至少需要 2 个字符").max(5000),
  negativePrompt: z.string().trim().max(2000).optional(),
  images: z.array(imageSchema).max(10).default([]),
  size: z.enum(["auto", "1024x1024", "1024x1536", "1536x1024", "960x1280", "1280x960"]),
  quality: z.enum(["auto", "high", "medium", "low"]),
  count: z.number().int().min(1).max(4),
  seed: z.number().int().min(0).max(2147483647).optional()
}).superRefine((value, context) => {
  if (value.operation === "image-edit" && value.images.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["images"],
      message: "图像编辑模式至少需要一张参考图"
    });
  }
});
