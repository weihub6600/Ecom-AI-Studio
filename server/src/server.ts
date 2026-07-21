import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app/create-app.js";
import { createAuthService } from "./auth.js";
import { createAppDatabase } from "./db/database.js";
import { migrateLegacyJsonData } from "./db/legacy-migration.js";
import { createHistoryService } from "./history.js";
import { startAsyncReconciliation } from "./services/async-reconciliation.js";
import { createModelSettingsService } from "./services/model-settings.js";
import { createAuditLogService } from "./services/audit-log.js";
import { createAdminQueryService } from "./services/admin-query.js";

export async function startServer(): Promise<void> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const projectRoot = path.resolve(currentDir, "../..");
  dotenv.config({ path: path.resolve(projectRoot, ".env") });

  const port = Number(process.env.PORT || 8787);
  const dataDir = path.resolve(projectRoot, process.env.IMAGE_STORAGE_DIR || "data");
  const webDist = path.resolve(projectRoot, "web/dist");
  const database = await createAppDatabase();
  const migrationResult = await migrateLegacyJsonData(database, dataDir);
  console.log(migrationResult.message);

  const modelSettingsService = createModelSettingsService(database);
  const auditLogService = createAuditLogService(database);
  const adminQueryService = createAdminQueryService(database);

  const historyService = createHistoryService({
    database,
    dataDir,
    maxRecords: Number(process.env.IMAGE_HISTORY_LIMIT || 0),
    maxImageBytes: Number(process.env.IMAGE_MAX_DOWNLOAD_BYTES || 41_943_040),
    downloadTimeoutMs: Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS || 120_000)
  });
  const authService = createAuthService({
    database,
    sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS || 2_592_000),
    adminUsername: process.env.ADMIN_USERNAME
  });
  await Promise.all([historyService.initialize(), authService.initialize(), modelSettingsService.initialize()]);

  const stopReconciliation = startAsyncReconciliation(authService);
  const app = createApp({
    database,
    authService,
    historyService,
    modelSettingsService,
    auditLogService,
    adminQueryService,
    secureAuthCookie: process.env.AUTH_COOKIE_SECURE === "true",
    webDist
  });
  const server = app.listen(port, () => {
    console.log(`Ecom AI Studio API: http://localhost:${port}`);
    console.log(`Generated images: ${historyService.generatedDir}`);
    console.log(`MySQL data: ${authService.authFile}`);
    if (!process.env.ADMIN_USERNAME) console.warn("ADMIN_USERNAME 未配置，无法自动创建或识别站长账号");
  });

  let closing = false;
  async function close(signal: string): Promise<void> {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}, shutting down...`);
    stopReconciliation();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await database.close().catch((error) => console.error("MySQL close error", error));
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void close(signal).finally(() => process.exit(0));
    });
  }
}
