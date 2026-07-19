export type ProviderId = "lingke";
export type OutputSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024" | "960x1280" | "1280x960";
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";

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

export interface UploadImage {
  id: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
  size: number;
}

export interface GeneratedImage {
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface GenerationResult {
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
