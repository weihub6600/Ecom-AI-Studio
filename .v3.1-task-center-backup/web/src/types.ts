export type ProviderId = "lingke" | "grsai" | "nanobanana";
export type OutputSize = string;
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";
export type GenerationOperation = "text-to-image" | "image-edit";
export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "disabled" | "rejected";
export type UsageStatus = "success" | "submitted" | "failed";
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
