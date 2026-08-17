import type {
  GeneratedImage,
  ProviderId
} from "../../types";

export type BatchRowStatus =
  | "draft"
  | "ready"
  | "running"
  | "success"
  | "failed";

export type BatchQueueState =
  | "idle"
  | "running"
  | "pausing"
  | "paused"
  | "completed";


export interface BatchRow {
  id: string;
  productName: string;
  prompt: string;
  negativePrompt: string;
  provider: ProviderId | "";
  model: string;
  size: string;
  count: number;
  referenceImageUrl: string;
  status: BatchRowStatus;
  validationErrors: string[];
  progress: string;
  error?: string;
  warning?: string;
  historyId?: string;
  taskId?: string;
  images: GeneratedImage[];
  pointsCost?: number;
}

export interface PersistedBatchState {
  version: 1;
  batchName: string;
  folderId?: string;
  defaultProvider: ProviderId;
  defaultModel: string;
  defaultSize: string;
  defaultCount: number;
  queueState: BatchQueueState;
  rows: BatchRow[];
  updatedAt: string;
}


export type ServerBatchStatus =
  | "draft"
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "completed"
  | "cancelled";

export interface ServerBatchItem {
  id: string;
  position: number;
  productName: string;
  prompt: string;
  negativePrompt?: string;
  provider: string;
  model: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  count: number;
  referenceImageUrl?: string;
  status: "queued" | "running" | "success" | "failed";
  progress?: string;
  error?: string;
  warning?: string;
  generationTaskId?: string;
  providerTaskId?: string;
  historyId?: string;
  pointsCost: number;
  attempts: number;
  images: GeneratedImage[];
  createdAt: string;
  updatedAt: string;
}

export interface ServerBatchJob {
  id: string;
  userId: string;
  username: string;
  name: string;
  folderId?: string;
  status: ServerBatchStatus;
  totalItems: number;
  successItems: number;
  failedItems: number;
  runningItems: number;
  queuedItems: number;
  progress: number;
  estimatedPoints: number;
  actualPoints: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  items?: ServerBatchItem[];
}

export interface BatchTemplateColumnMapping {
  productName?: string;
  prompt?: string;
  negativePrompt?: string;
  provider?: string;
  model?: string;
  size?: string;
  count?: string;
  referenceImageUrl?: string;
}

export interface BatchTemplateRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  provider: string;
  model: string;
  size: string;
  count: number;
  promptTemplate: string;
  negativePromptTemplate?: string;
  referenceImageUrl?: string;
  columnMapping: BatchTemplateColumnMapping;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export type BatchTemplateColumnKey =
  keyof BatchTemplateColumnMapping;

export interface ZipTextReader {
  file(path: string): {
    async(type: "string"): Promise<string>;
  } | null;
}
