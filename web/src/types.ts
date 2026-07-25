export type ProviderId = "lingke" | "grsai" | "nanobanana";
export type OutputSize = string;
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";
export type GenerationOperation = "text-to-image" | "image-edit";
export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "disabled" | "rejected";
export type UsageStatus = "success" | "submitted" | "failed";
export type GenerationTaskStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";
export type CreditTransactionType = "generation_charge" | "generation_refund" | "card_recharge" | "admin_adjustment";

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
  creditCost?: number;
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

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  credits: number;
}

export interface AdminUserSummary extends AuthUser {
  loginCount: number;
  usageCount: number;
  lastLoginIp?: string;
}

export interface ServerHistoryRecord {
  id: string;
  createdAt: string;
  clientId: string;
  clientIp?: string;
  userAgent?: string;
  provider: ProviderId;
  providerName: string;
  model: string;
  prompt: string;
  operation: GenerationOperation;
  size: OutputSize;
  durationMs?: number;
  cost?: number;
  images: GeneratedImage[];
}

export interface GenerationTaskRequestSnapshot {
  provider?: ProviderId;
  model?: string;
  operation?: GenerationOperation;
  prompt?: string;
  negativePrompt?: string;
  size?: string;
  count?: number;
  seed?: number;
}

export interface GenerationTask {
  id: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  provider: string;
  model: string;
  operation: GenerationOperation;
  size: string;
  prompt?: string;
  status: GenerationTaskStatus;
  stage: string;
  progress: number;
  requestedImageCount: number;
  actualImageCount: number;
  operationId?: string;
  providerTaskId?: string;
  historyId?: string;
  reservedPoints?: number;
  actualPoints?: number;
  refundedPoints: number;
  requestSnapshot?: GenerationTaskRequestSnapshot;
  thumbnailUrl?: string;
  providerProgress?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type GenerationTaskStatusFilter =
  | "all"
  | "active"
  | GenerationTaskStatus;

export interface GenerationTaskPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface GenerationTaskSummary {
  total: number;
  active: number;
  success: number;
  failed: number;
  cancelled: number;
}

export interface GenerationTaskQueryState {
  status: GenerationTaskStatusFilter;
  provider: "all" | ProviderId;
  search: string;
  page: number;
  pageSize: number;
}

export interface UsageRecord {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  operation: GenerationOperation;
  size: string;
  prompt?: string;
  imageCount: number;
  status: UsageStatus;
  durationMs?: number;
  pointsCost?: number;
  pointsRefunded?: boolean;
  requestId?: string;
  operationId?: string;
  error?: string;
}

export interface LoginRecord {
  id: string;
  username: string;
  success: boolean;
  reason?: string;
  createdAt: string;
  clientIp?: string;
  userAgent?: string;
}

export interface CreditRecord {
  id: string;
  createdAt: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  note?: string;
  provider?: string;
  model?: string;
}

export interface PriceItem {
  provider: string;
  model: string;
  name: string;
  points: number;
}

export interface RechargeCard {
  id: string;
  codePreview: string;
  code?: string;
  points: number;
  createdAt: string;
  createdBy: string;
  redeemedAt?: string;
  redeemedByUsername?: string;
  status: "unused" | "redeemed";
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DashboardData {
  users: { total: number; pending: number; active: number; disabled: number; rejected: number };
  today: { usage: number; success: number; failed: number; images: number; averageDurationMs: number; spentPoints: number; rechargedPoints: number };
  storage: { histories: number; images: number };
  daily: Array<{ label: string; usageCount: number; imageCount: number }>;
  models: Array<{ provider: string; model: string; usageCount: number; imageCount: number }>;
}

export interface AdminModelSetting {
  provider: string;
  model: string;
  name: string;
  providerName: string;
  enabled: boolean;
  points: number;
  configured: boolean;
  description: string;
  asynchronous: boolean;
  maxOutputImages: number;
  updatedAt?: string;
}

export interface AdminAuditRecord {
  id: string;
  actorUserId?: string;
  actorUsername: string;
  action: string;
  targetType: string;
  targetId?: string;
  summary: string;
  details?: unknown;
  clientIp?: string;
  userAgent?: string;
  createdAt: string;
}

export type AdminTaskStatusFilter =
  | "all"
  | "active"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface AdminTaskRecord {
  id: string;
  userId: string;
  username: string;
  provider: string;
  model: string;
  operation:
    | "text-to-image"
    | "image-edit";
  size: string;
  prompt?: string;
  status:
    | "queued"
    | "running"
    | "success"
    | "failed"
    | "cancelled";
  stage: string;
  progress: number;
  requestedImageCount: number;
  actualImageCount: number;
  providerTaskId?: string;
  operationId?: string;
  historyId?: string;
  reservedPoints: number;
  actualPoints: number;
  refundedPoints: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  stale: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface AdminTaskPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminTaskSummary {
  total: number;
  active: number;
  stale: number;
  success24h: number;
  failed24h: number;
  refundedPoints24h: number;
  averageDurationMs24h: number;
}

export interface AdminModelTaskHealth {
  provider: string;
  model: string;
  total: number;
  active: number;
  success: number;
  failed: number;
  successRate: number;
  averageDurationMs: number;
  lastTaskAt?: string;
}

export interface TaskRecoveryStats {
  scanned: number;
  progressed: number;
  completed: number;
  failed: number;
  errors: number;
}
