import { randomUUID } from "node:crypto";
import type { ResultSetHeader } from "mysql2/promise";
import type { AppDatabase } from "../db/database.js";
import type { PublicUser } from "../auth/contracts.js";

export interface AuditContext {
  clientIp?: string;
  userAgent?: string;
}

export interface AuditInput {
  actor: PublicUser;
  action: string;
  targetType: string;
  targetId?: string;
  summary: string;
  details?: unknown;
  context?: AuditContext;
}

export function createAuditLogService(database: AppDatabase) {
  async function record(input: AuditInput): Promise<void> {
    await database.pool.execute<ResultSetHeader>(
      `INSERT INTO app_admin_audit_logs
        (id, actor_user_id, actor_username, action, target_type, target_id, summary, details_json, client_ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.actor.id,
        input.actor.username,
        input.action.slice(0, 80),
        input.targetType.slice(0, 80),
        input.targetId?.slice(0, 200) || null,
        input.summary.slice(0, 500),
        input.details === undefined ? null : JSON.stringify(input.details),
        input.context?.clientIp?.slice(0, 120) || null,
        input.context?.userAgent?.slice(0, 600) || null,
        new Date()
      ]
    );
  }

  async function safeRecord(input: AuditInput): Promise<void> {
    try {
      await record(input);
    } catch (error) {
      console.error("Admin audit log error", error);
    }
  }

  return { record, safeRecord };
}

export type AuditLogService = ReturnType<typeof createAuditLogService>;
