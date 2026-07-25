import type { AppDatabase } from "../db/database.js";
import type { AuthService } from "../auth.js";
import type { HistoryService } from "../history.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import type { AuditLogService } from "../services/audit-log.js";
import type { AdminQueryService } from "../services/admin-query.js";
import type { HealthService } from "../services/health.js";
import type { BatchJobService } from "../services/batch-jobs.js";

export interface AppContext {
  database: AppDatabase;
  authService: AuthService;
  historyService: HistoryService;
  modelSettingsService: ModelSettingsService;
  auditLogService: AuditLogService;
  adminQueryService: AdminQueryService;
  healthService: HealthService;
  batchJobService: BatchJobService;
  secureAuthCookie: boolean;
  webDist: string;
}