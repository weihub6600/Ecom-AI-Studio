import type { AppDatabase } from "../db/database.js";
import type { AuthService } from "../auth.js";
import type {
  RegistrationSettingsService
} from "../services/registration-settings.js";
import type { HistoryService } from "../history.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import type { AuditLogService } from "../services/audit-log.js";
import type { AdminQueryService } from "../services/admin-query.js";
import type { HealthService } from "../services/health.js";
import type { BatchJobService } from "../services/batch-jobs.js";
import type { CustomProviderService } from "../services/custom-providers.js";
import type {
  BuiltInProviderSettingsService
} from "../services/builtin-provider-settings.js";

export interface AppContext {
  database: AppDatabase;
  authService: AuthService;
  registrationSettingsService:
    RegistrationSettingsService;
  historyService: HistoryService;
  modelSettingsService: ModelSettingsService;
  auditLogService: AuditLogService;
  adminQueryService: AdminQueryService;
  healthService: HealthService;
  batchJobService: BatchJobService;
  customProviderService: CustomProviderService;
  builtInProviderSettingsService:
    BuiltInProviderSettingsService;
  secureAuthCookie: boolean;
  webDist: string;
}