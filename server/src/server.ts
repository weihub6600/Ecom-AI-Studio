import dotenv from "dotenv";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  createApp
} from "./app/create-app.js";
import {
  createAuthService
} from "./auth.js";
import {
  createRegistrationSettingsService
} from "./services/registration-settings.js";
import {
  createAppDatabase
} from "./db/database.js";
import {
  migrateLegacyJsonData
} from "./db/legacy-migration.js";
import {
  createHistoryService
} from "./history.js";
import {
  startAsyncReconciliation
} from "./services/async-reconciliation.js";
import {
  createModelSettingsService
} from "./services/model-settings.js";
import {
  createAuditLogService
} from "./services/audit-log.js";
import {
  createAdminQueryService
} from "./services/admin-query.js";
import {
  createHealthService
} from "./services/health.js";
import {
  createBatchJobService
} from "./services/batch-jobs.js";
import {
  createCustomProviderService
} from "./services/custom-providers.js";
import {
  createBuiltInProviderSettingsService
} from "./services/builtin-provider-settings.js";

export async function startServer():
  Promise<void> {
  const currentFile =
    fileURLToPath(import.meta.url);

  const currentDir =
    path.dirname(currentFile);

  const projectRoot =
    path.resolve(
      currentDir,
      "../.."
    );

  dotenv.config({
    path:
      path.resolve(
        projectRoot,
        ".env"
      )
  });

  const port =
    Number(
      process.env.PORT ||
      8787
    );

  const dataDir =
    path.resolve(
      projectRoot,
      process.env
        .IMAGE_STORAGE_DIR ||
      "data"
    );

  const webDist =
    path.resolve(
      projectRoot,
      "web/dist"
    );

  const secureAuthCookie =
    process.env
      .AUTH_COOKIE_SECURE ===
    "true";

  const database =
    await createAppDatabase();

  const migrationResult =
    await migrateLegacyJsonData(
      database,
      dataDir
    );

  console.log(
    migrationResult.message
  );

  const registrationSettingsService =
    createRegistrationSettingsService(
      database
    );

  const modelSettingsService =
    createModelSettingsService(
      database
    );

  const auditLogService =
    createAuditLogService(
      database
    );

  const adminQueryService =
    createAdminQueryService(
      database
    );

  const historyService =
    createHistoryService({
      database,
      dataDir,
      maxRecords:
        Number(
          process.env
            .IMAGE_HISTORY_LIMIT ||
          0
        ),
      maxImageBytes:
        Number(
          process.env
            .IMAGE_MAX_DOWNLOAD_BYTES ||
          41_943_040
        ),
      downloadTimeoutMs:
        Number(
          process.env
            .IMAGE_DOWNLOAD_TIMEOUT_MS ||
          120_000
        )
    });

  const healthService =
    createHealthService({
      database,
      generatedDir:
        historyService.generatedDir,
      secureCookie:
        secureAuthCookie
    });

  const authService =
    createAuthService({
      database,
      sessionTtlSeconds:
        Number(
          process.env
            .AUTH_SESSION_TTL_SECONDS ||
          2_592_000
        ),
      adminUsername:
        process.env.ADMIN_USERNAME
    });

  const builtInProviderSettingsService =
    createBuiltInProviderSettingsService(
      database
    );

  const customProviderService =
    createCustomProviderService(
      database
    );

  const batchJobService =
    createBatchJobService({
      database,
      modelSettingsService,
      baseUrl: `http://127.0.0.1:${port}`
    });

  await builtInProviderSettingsService.initialize();

  await Promise.all([
    registrationSettingsService
      .initialize(),
    historyService.initialize(),
    authService.initialize(),
    customProviderService.initialize(),
    modelSettingsService.initialize(),
    batchJobService.initialize()
  ]);

  const health =
    await healthService.check();

  console.log(
    `启动健康状态：${health.status}`
  );

  console.log(
    `MySQL 延迟：${health.mysql.latencyMs} 毫秒`
  );

  console.log(
    `磁盘使用率：${health.storage.usedPercent}%`
  );

  if (health.status !== "ok") {
    console.warn(
      "服务器启动时发现健康预警",
      JSON.stringify(health)
    );
  }

  const stopReconciliation =
    startAsyncReconciliation(
      database,
      authService,
      historyService,
      modelSettingsService
    );

  const app =
    createApp({
      database,
      authService,
      historyService,
      modelSettingsService,
      auditLogService,
      adminQueryService,
      healthService,
      batchJobService,
      customProviderService,
      builtInProviderSettingsService:
        builtInProviderSettingsService,
      registrationSettingsService:
        registrationSettingsService,
      secureAuthCookie,
      webDist
    });

  const server =
    app.listen(
      port,
      () => {
        console.log(
          `Ecom AI Studio API：http://localhost:${port}`
        );

        console.log(
          `生成图片目录：${historyService.generatedDir}`
        );

        console.log(
          `MySQL 数据库：${authService.authFile}`
        );

        if (
          !process.env
            .ADMIN_USERNAME
        ) {
          console.warn(
            "尚未配置 ADMIN_USERNAME，无法自动识别站长账号"
          );
        }
      }
    );

  const stopBatchWorker =
    batchJobService.startWorker();

  let closing = false;

  async function close(
    signal: string
  ): Promise<void> {
    if (closing) return;

    closing = true;

    console.log(
      `收到 ${signal}，正在安全关闭服务器……`
    );

    stopReconciliation();
    stopBatchWorker();

    await new Promise<void>(
      (resolve) => {
        server.close(
          () => resolve()
        );
      }
    );

    await database.close()
      .catch((error) => {
        console.error(
          "关闭 MySQL 连接失败",
          error
        );
      });
  }

  for (
    const signal of [
      "SIGINT",
      "SIGTERM"
    ] as const
  ) {
    process.once(
      signal,
      () => {
        void close(signal)
          .finally(
            () => process.exit(0)
          );
      }
    );
  }
}