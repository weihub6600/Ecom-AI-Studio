import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProviderAdapter,
  ProviderId
} from "./types.js";
import { LingkeAdapter } from "./providers/lingke.js";
import { GrsaiAdapter } from "./providers/grsai.js";

const adapters = new Map<ProviderId, ImageProviderAdapter>([
  ["lingke", new LingkeAdapter()],
  ["grsai", new GrsaiAdapter()]
]);

function getAdapter(provider: ProviderId): ImageProviderAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) throw new Error(`不支持的模型厂商：${provider}`);
  return adapter;
}

export async function generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
  return getAdapter(request.provider).generate(request);
}

export async function getImageTask(
  provider: ProviderId,
  taskId: string,
  model?: string
): Promise<GenerateImageResult> {
  const adapter = getAdapter(provider);
  if (!adapter.getTask) throw new Error(`${provider} 不支持异步任务查询`);
  return adapter.getTask(taskId, model);
}
