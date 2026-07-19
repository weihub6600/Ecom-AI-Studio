import type { GenerateImageRequest, GenerateImageResult } from "./types.js";
import { LingkeAdapter } from "./providers/lingke.js";

const adapter = new LingkeAdapter();

export async function generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
  if (request.provider !== "lingke") {
    throw new Error(`不支持的模型厂商：${request.provider}`);
  }
  return adapter.generate(request);
}

export async function getImageTask(taskId: string, model?: string): Promise<GenerateImageResult> {
  return adapter.getTask(taskId, model);
}
