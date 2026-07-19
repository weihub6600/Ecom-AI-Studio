export type ProviderId = "lingke" | "grsai";
export type ImageOperation = "text-to-image" | "image-edit";
export type OutputSize = string;
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";

export interface InputImage {
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
}

export interface GenerateImageRequest {
  provider: ProviderId;
  model: string;
  operation: ImageOperation;
  prompt: string;
  negativePrompt?: string;
  images: InputImage[];
  size: OutputSize;
  quality?: ImageQuality;
  count: number;
  seed?: number;
}

export interface GeneratedImage {
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface GenerateImageResult {
  provider: ProviderId;
  model: string;
  images: GeneratedImage[];
  durationMs: number;
  requestId?: string;
  taskId?: string;
  status?: GenerationStatus;
  progress?: string;
  cost?: number;
  error?: string;
}

export interface ModelCapability {
  id: string;
  provider: ProviderId;
  providerName: string;
  name: string;
  description: string;
  configured: boolean;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  sizes: OutputSize[];
  qualities: ImageQuality[];
  maxOutputImages: number;
  asynchronous?: boolean;
}

export interface ImageProviderAdapter {
  readonly provider: ProviderId;
  generate(request: GenerateImageRequest): Promise<GenerateImageResult>;
  getTask?(taskId: string, model?: string): Promise<GenerateImageResult>;
}
