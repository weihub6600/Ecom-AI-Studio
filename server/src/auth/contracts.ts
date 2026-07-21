export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "disabled" | "rejected";
export type UsageStatus = "success" | "submitted" | "failed";
export type CreditTransactionType = "generation_charge" | "generation_refund" | "card_recharge" | "admin_adjustment";

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  credits: number;
}

export interface AdminUserSummary extends PublicUser {
  loginCount: number;
  usageCount: number;
  lastLoginIp?: string;
}

export interface LoginRecord {
  id: string;
  userId?: string;
  username: string;
  success: boolean;
  reason?: string;
  createdAt: string;
  clientIp?: string;
  userAgent?: string;
}

export interface UsageRecord {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
  provider: string;
  model: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  prompt?: string;
  imageCount: number;
  status: UsageStatus;
  durationMs?: number;
  cost?: number;
  requestId?: string;
  operationId?: string;
  pointsCost?: number;
  pointsRefunded?: boolean;
  error?: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  note?: string;
  provider?: string;
  model?: string;
  referenceId?: string;
  cardId?: string;
  actorUserId?: string;
}

export interface RechargeCardSummary {
  id: string;
  codePreview: string;
  points: number;
  createdAt: string;
  createdBy: string;
  redeemedAt?: string;
  redeemedByUserId?: string;
  redeemedByUsername?: string;
  status: "unused" | "redeemed";
}

export interface GeneratedRechargeCard extends RechargeCardSummary {
  code: string;
}

export interface AuthAuditContext {
  clientIp?: string;
  userAgent?: string;
}

export interface UsageRecordInput {
  userId: string;
  provider: string;
  model: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  prompt?: string;
  imageCount: number;
  status: UsageStatus;
  durationMs?: number;
  cost?: number;
  requestId?: string;
  operationId?: string;
  pointsCost?: number;
  pointsRefunded?: boolean;
  error?: string;
}

export interface GenerationReservation {
  operationId: string;
  pointsCost: number;
  balance: number;
}

export interface GenerationSettlement {
  balance: number;
  pointsCost: number;
  refunded: boolean;
  refundAmount: number;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}
