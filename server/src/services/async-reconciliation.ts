import {
  randomUUID
} from "node:crypto";
import type {
  RowDataPacket
} from "mysql2/promise";
import type {
  AuthService
} from "../auth.js";
import type {
  AppDatabase
} from "../db/database.js";
import type {
  HistoryProviderId,
  HistoryService,
  StoredHistoryRecord
} from "../history.js";
import {
  calculateGenerationCreditCost
} from "../pricing.js";
import {
  getImageTask
} from "../router.js";
import type {
  GenerateImageResult,
  ProviderId
} from "../types.js";
import {
  archiveGenerationResult
} from "./generation-result-archive.js";
import {
  parseProviderProgress,
  updateGenerationTask
} from "./generation-tasks.js";
import type {
  ModelSettingsService
} from "./model-settings.js";

interface RecoverableTask {
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
    | "success";
  stage: string;
  progress: number;
  requestedImageCount: number;
  actualImageCount: number;
  operationId?: string;
  providerTaskId?: string;
  historyId?: string;
  reservedPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskRecoveryStats {
  scanned: number;
  progressed: number;
  completed: number;
  failed: number;
  errors: number;
}

interface UsageWriteInput {
  status:
    | "submitted"
    | "success"
    | "failed";
  imageCount: number;
  pointsCost: number;
  pointsRefunded: boolean;
  durationMs?: number;
  cost?: number;
  error?: string;
}

let activeRecoveryRun:
  Promise<TaskRecoveryStats> |
  undefined;

export async function runTaskRecoveryOnce(
  database: AppDatabase,
  authService: AuthService,
  historyService: HistoryService,
  modelSettingsService:
    ModelSettingsService,
  limit = 100
): Promise<TaskRecoveryStats> {
  if (activeRecoveryRun) {
    return activeRecoveryRun;
  }

  activeRecoveryRun =
    executeTaskRecoveryOnce(
      database,
      authService,
      historyService,
      modelSettingsService,
      limit
    );

  try {
    return await activeRecoveryRun;
  } finally {
    activeRecoveryRun = undefined;
  }
}

export function startAsyncReconciliation(
  database: AppDatabase,
  authService: AuthService,
  historyService: HistoryService,
  modelSettingsService:
    ModelSettingsService,
  intervalMs =
    readPositiveEnv(
      "GENERATION_RECOVERY_INTERVAL_MS",
      30_000,
      10_000
    )
): () => void {
  const run = () =>
    void runTaskRecoveryOnce(
      database,
      authService,
      historyService,
      modelSettingsService
    ).then(logTaskRecoveryStats)
      .catch((error) => {
        console.error(
          "任务恢复扫描失败",
          error
        );
      });

  const timer =
    setInterval(
      run,
      intervalMs
    );

  timer.unref();

  run();

  return () =>
    clearInterval(timer);
}

async function executeTaskRecoveryOnce(
  database: AppDatabase,
  authService: AuthService,
  historyService: HistoryService,
  modelSettingsService:
    ModelSettingsService,
  limit: number
): Promise<TaskRecoveryStats> {
  const syncStaleMs =
    readPositiveEnv(
      "GENERATION_SYNC_STALE_MS",
      20 * 60_000,
      5 * 60_000
    );

  const asyncMaxAgeMs =
    readPositiveEnv(
      "GENERATION_ASYNC_MAX_AGE_MS",
      24 * 60 * 60_000,
      30 * 60_000
    );

  const stats: TaskRecoveryStats = {
    scanned: 0,
    progressed: 0,
    completed: 0,
    failed: 0,
    errors: 0
  };

  const tasks =
    await listRecoverableTasks(
      database,
      Math.max(
        1,
        Math.min(
          500,
          Math.trunc(limit) || 100
        )
      )
    );

  for (const task of tasks) {
    stats.scanned += 1;

    try {
      const action =
        await reconcileTask({
          database,
          authService,
          historyService,
          modelSettingsService,
          task,
          syncStaleMs,
          asyncMaxAgeMs
        });

      if (
        action === "progressed"
      ) {
        stats.progressed += 1;
      } else if (
        action === "completed"
      ) {
        stats.completed += 1;
      } else if (
        action === "failed"
      ) {
        stats.failed += 1;
      }
    } catch (error) {
      stats.errors += 1;

      console.error(
        "生成任务恢复失败",
        task.id,
        error
      );
    }
  }

  return stats;
}

function logTaskRecoveryStats(
  stats: TaskRecoveryStats
): void {
  if (
    stats.progressed === 0 &&
    stats.completed === 0 &&
    stats.failed === 0 &&
    stats.errors === 0
  ) {
    return;
  }

  console.log(
    [
      "任务恢复扫描",
      `扫描 ${stats.scanned}`,
      `更新 ${stats.progressed}`,
      `完成 ${stats.completed}`,
      `失败 ${stats.failed}`,
      `异常 ${stats.errors}`
    ].join(" · ")
  );
}

async function reconcileTask(
  options: {
    database: AppDatabase;
    authService: AuthService;
    historyService: HistoryService;
    modelSettingsService:
      ModelSettingsService;
    task: RecoverableTask;
    syncStaleMs: number;
    asyncMaxAgeMs: number;
  }
): Promise<
  | "unchanged"
  | "progressed"
  | "completed"
  | "failed"
> {
  const {
    database,
    authService,
    historyService,
    modelSettingsService,
    task,
    syncStaleMs,
    asyncMaxAgeMs
  } = options;

  const existingHistory =
    await findExistingHistory(
      historyService,
      task
    );

  if (
    existingHistory &&
    existingHistory.images.length > 0
  ) {
    const provider =
      readProvider(task.provider);

    if (!provider) {
      return failTask({
        database,
        authService,
        task,
        code:
          "UNSUPPORTED_PROVIDER",
        message:
          `无法恢复未知服务商：${task.provider}`
      });
    }

    const result:
      GenerateImageResult = {
        provider,
        model:
          task.model,
        images:
          existingHistory.images,
        durationMs:
          existingHistory.durationMs ||
          0,
        cost:
          existingHistory.cost,
        status:
          "completed",
        progress:
          "100%",
        taskId:
          task.providerTaskId
      };

    await completeTask({
      database,
      authService,
      historyService,
      modelSettingsService,
      task,
      result,
      existingHistory
    });

    return "completed";
  }

  if (
    task.provider === "lingke" &&
    task.providerTaskId
  ) {
    return reconcileLingkeTask({
      database,
      authService,
      historyService,
      modelSettingsService,
      task,
      asyncMaxAgeMs
    });
  }

  if (
    isOlderThan(
      task.updatedAt,
      syncStaleMs
    )
  ) {
    return failTask({
      database,
      authService,
      task,
      code:
        "TASK_RECOVERY_TIMEOUT",
      message:
        "服务重启后无法恢复该同步任务，已按超时任务处理并退回可退积分"
    });
  }

  return "unchanged";
}

async function reconcileLingkeTask(
  options: {
    database: AppDatabase;
    authService: AuthService;
    historyService: HistoryService;
    modelSettingsService:
      ModelSettingsService;
    task: RecoverableTask;
    asyncMaxAgeMs: number;
  }
): Promise<
  | "progressed"
  | "completed"
  | "failed"
  | "unchanged"
> {
  const {
    database,
    authService,
    historyService,
    modelSettingsService,
    task,
    asyncMaxAgeMs
  } = options;

  let result:
    GenerateImageResult;

  try {
    result =
      await getImageTask(
        "lingke",
        task.providerTaskId!,
        task.model
      );
  } catch (error) {
    if (
      isOlderThan(
        task.createdAt,
        asyncMaxAgeMs
      )
    ) {
      return failTask({
        database,
        authService,
        task,
        code:
          "ASYNC_RECOVERY_EXPIRED",
        message:
          `异步任务超过恢复时限且无法查询：${errorMessage(error)}`
      });
    }

    await updateGenerationTask(
      database,
      task.id,
      {
        status:
          task.status === "success"
            ? "running"
            : task.status,
        stage:
          "processing",
        progress:
          Math.max(
            task.progress,
            45
          ),
        providerProgress:
          "服务商状态暂时无法读取，系统会自动重试"
      }
    );

    return "unchanged";
  }

  if (
    result.status === "completed" &&
    result.images.length > 0
  ) {
    await completeTask({
      database,
      authService,
      historyService,
      modelSettingsService,
      task,
      result
    });

    return "completed";
  }

  if (
    result.status === "failed"
  ) {
    return failTask({
      database,
      authService,
      task,
      code:
        "PROVIDER_TASK_FAILED",
      message:
        result.error ||
        "服务商返回任务失败",
      durationMs:
        result.durationMs,
      cost:
        result.cost
    });
  }

  await ensureSubmittedUsage(
    database,
    task
  );

  await updateGenerationTask(
    database,
    task.id,
    {
      status: "running",
      stage: "processing",
      progress:
        parseProviderProgress(
          result.progress,
          Math.max(
            task.progress,
            45
          )
        ),
      providerTaskId:
        task.providerTaskId,
      providerProgress:
        result.progress ||
        "服务端正在恢复异步任务",
      markStarted: true
    }
  );

  return "progressed";
}

async function completeTask(
  options: {
    database: AppDatabase;
    authService: AuthService;
    historyService: HistoryService;
    modelSettingsService:
      ModelSettingsService;
    task: RecoverableTask;
    result: GenerateImageResult;
    existingHistory?:
      StoredHistoryRecord;
  }
): Promise<void> {
  const {
    database,
    authService,
    historyService,
    modelSettingsService,
    task,
    result
  } = options;

  const runtimeModel =
    modelSettingsService.get(
      "lingke",
      task.model
    );

  const providerName =
    runtimeModel
      ?.capability
      .providerName ||
    "百嘉瑞AI";

  const historyRecord =
    options.existingHistory ||
    await archiveGenerationResult({
      database,
      historyService,
      taskId:
        task.id,
      userId:
        task.userId,
      username:
        task.username,
      provider:
        "lingke",
      providerName,
      model:
        task.model,
      prompt:
        task.prompt ||
        "AI 图片生成",
      operation:
        task.operation,
      size:
        task.size,
      result
    });

  await updateGenerationTask(
    database,
    task.id,
    {
      status: "running",
      stage: "settling",
      progress: 98,
      historyId:
        historyRecord.id,
      providerProgress:
        "正在恢复积分结算"
    }
  );

  const unitPoints =
    task.requestedImageCount > 0
      ? task.reservedPoints /
        task.requestedImageCount
      : runtimeModel?.points || 0;

  const targetPoints =
    calculateGenerationCreditCost(
      unitPoints,
      result.images.length
    );

  const settlement =
    task.operationId
      ? await authService
          .settleGenerationCredits(
            task.userId,
            task.operationId,
            targetPoints,
            "服务端恢复任务后按实际图片数量结算"
          )
      : {
          balance: 0,
          pointsCost:
            targetPoints,
          refunded: false,
          refundAmount: 0
        };

  await upsertFinalUsage(
    database,
    task,
    {
      status: "success",
      imageCount:
        result.images.length,
      pointsCost:
        settlement.pointsCost,
      pointsRefunded:
        settlement.refundAmount > 0,
      durationMs:
        result.durationMs,
      cost:
        result.cost
    }
  );

  await updateGenerationTask(
    database,
    task.id,
    {
      status: "success",
      stage: "completed",
      progress: 100,
      actualImageCount:
        result.images.length,
      providerTaskId:
        task.providerTaskId ||
        result.taskId ||
        result.requestId,
      historyId:
        historyRecord.id,
      actualPoints:
        settlement.pointsCost,
      refundedPoints:
        settlement.refundAmount,
      providerProgress:
        "任务已由服务端恢复完成",
      markStarted: true,
      markCompleted: true
    }
  );
}

async function failTask(
  options: {
    database: AppDatabase;
    authService: AuthService;
    task: RecoverableTask;
    code: string;
    message: string;
    durationMs?: number;
    cost?: number;
  }
): Promise<"failed"> {
  const {
    database,
    authService,
    task,
    code,
    message
  } = options;

  const settlement =
    task.operationId
      ? await authService
          .settleGenerationCredits(
            task.userId,
            task.operationId,
            0,
            message
          )
      : {
          balance: 0,
          pointsCost: 0,
          refunded: false,
          refundAmount: 0
        };

  await upsertFinalUsage(
    database,
    task,
    {
      status: "failed",
      imageCount: 0,
      pointsCost:
        settlement.pointsCost,
      pointsRefunded:
        settlement.refundAmount > 0,
      durationMs:
        options.durationMs,
      cost:
        options.cost,
      error:
        message
    }
  );

  await updateGenerationTask(
    database,
    task.id,
    {
      status: "failed",
      stage:
        settlement.refundAmount > 0
          ? "refunded"
          : "failed",
      progress: 100,
      actualImageCount: 0,
      actualPoints:
        settlement.pointsCost,
      refundedPoints:
        settlement.refundAmount,
      providerProgress:
        settlement.refundAmount > 0
          ? "任务恢复失败，积分已退回"
          : "任务恢复失败",
      errorCode:
        code,
      errorMessage:
        message,
      markCompleted: true
    }
  );

  return "failed";
}

async function listRecoverableTasks(
  database: AppDatabase,
  limit: number
): Promise<RecoverableTask[]> {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        500,
        Math.trunc(limit)
      )
    );

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         t.*,
         u.username
       FROM app_generation_tasks t
       INNER JOIN app_users u
         ON u.id = t.user_id
       WHERE
         t.status IN ('queued','running')
         OR (
           t.status = 'success'
           AND t.history_id IS NULL
           AND t.provider = 'lingke'
           AND t.provider_task_id IS NOT NULL
         )
       ORDER BY
         t.updated_at ASC
       LIMIT ?`,
      [safeLimit]
    );

  return rows.map(
    mapRecoverableTask
  );
}

function mapRecoverableTask(
  row: RowDataPacket
): RecoverableTask {
  return {
    id:
      String(row.id),
    userId:
      String(row.user_id),
    username:
      String(row.username),
    provider:
      String(row.provider),
    model:
      String(row.model),
    operation:
      row.operation === "image-edit"
        ? "image-edit"
        : "text-to-image",
    size:
      String(row.size),
    prompt:
      optionalText(
        row.prompt
      ),
    status:
      row.status === "success"
        ? "success"
        : row.status === "queued"
          ? "queued"
          : "running",
    stage:
      String(
        row.task_stage ||
        "queued"
      ),
    progress:
      Math.max(
        0,
        Math.min(
          100,
          Number(
            row.progress || 0
          )
        )
      ),
    requestedImageCount:
      Math.max(
        0,
        Number(
          row.requested_image_count ||
          0
        )
      ),
    actualImageCount:
      Math.max(
        0,
        Number(
          row.actual_image_count ||
          0
        )
      ),
    operationId:
      optionalText(
        row.operation_id
      ),
    providerTaskId:
      optionalText(
        row.provider_task_id
      ),
    historyId:
      optionalText(
        row.history_id
      ),
    reservedPoints:
      centsToPoints(
        row.reserved_points_cents
      ),
    createdAt:
      readDate(
        row.created_at
      ),
    updatedAt:
      readDate(
        row.updated_at
      )
  };
}

async function findExistingHistory(
  historyService: HistoryService,
  task: RecoverableTask
): Promise<
  StoredHistoryRecord |
  undefined
> {
  if (task.historyId) {
    const byId =
      await historyService.getById(
        task.historyId,
        task.userId
      );

    if (byId) return byId;
  }

  return historyService
    .getByGenerationTaskId(
      task.id,
      task.userId
    );
}

async function ensureSubmittedUsage(
  database: AppDatabase,
  task: RecoverableTask
): Promise<void> {
  const usageId =
    await findUsageId(
      database,
      task
    );

  if (usageId) return;

  await database.pool.execute(
    `INSERT INTO app_usage_records
      (id, user_id, username, created_at, provider, model, operation, size, prompt,
       image_count, status, duration_ms, cost, request_id, operation_id,
       points_cost_cents, points_refunded, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NULL, NULL, ?, ?, ?, 0, NULL)`,
    [
      randomUUID(),
      task.userId,
      task.username,
      task.createdAt,
      task.provider,
      task.model,
      task.operation,
      task.size,
      task.prompt ?? null,
      task.requestedImageCount,
      task.providerTaskId ?? null,
      task.operationId ?? null,
      pointsToCents(
        task.reservedPoints
      )
    ]
  );
}

async function upsertFinalUsage(
  database: AppDatabase,
  task: RecoverableTask,
  input: UsageWriteInput
): Promise<void> {
  const usageId =
    await findUsageId(
      database,
      task
    );

  const pointsCostCents =
    pointsToCents(
      input.pointsCost
    );

  if (usageId) {
    await database.pool.execute(
      `UPDATE app_usage_records
       SET
         status = ?,
         image_count = ?,
         duration_ms = ?,
         cost = ?,
         request_id = COALESCE(request_id, ?),
         operation_id = COALESCE(operation_id, ?),
         points_cost_cents = ?,
         points_refunded = ?,
         error = ?
       WHERE id = ?`,
      [
        input.status,
        Math.max(
          0,
          Math.trunc(
            input.imageCount
          )
        ),
        optionalInteger(
          input.durationMs
        ),
        optionalNumber(
          input.cost
        ),
        task.providerTaskId ?? null,
        task.operationId ?? null,
        pointsCostCents,
        input.pointsRefunded
          ? 1
          : 0,
        limitText(
          input.error,
          800
        ) ?? null,
        usageId
      ]
    );

    return;
  }

  await database.pool.execute(
    `INSERT INTO app_usage_records
      (id, user_id, username, created_at, provider, model, operation, size, prompt,
       image_count, status, duration_ms, cost, request_id, operation_id,
       points_cost_cents, points_refunded, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      task.userId,
      task.username,
      task.createdAt,
      task.provider,
      task.model,
      task.operation,
      task.size,
      task.prompt ?? null,
      Math.max(
        0,
        Math.trunc(
          input.imageCount
        )
      ),
      input.status,
      optionalInteger(
        input.durationMs
      ),
      optionalNumber(
        input.cost
      ),
      task.providerTaskId ?? null,
      task.operationId ?? null,
      pointsCostCents,
      input.pointsRefunded
        ? 1
        : 0,
      limitText(
        input.error,
        800
      ) ?? null
    ]
  );
}

async function findUsageId(
  database: AppDatabase,
  task: RecoverableTask
): Promise<string | undefined> {
  const clauses: string[] = [];
  const values: string[] = [
    task.userId
  ];

  if (task.operationId) {
    clauses.push(
      "operation_id = ?"
    );

    values.push(
      task.operationId
    );
  }

  if (task.providerTaskId) {
    clauses.push(
      "request_id = ?"
    );

    values.push(
      task.providerTaskId
    );
  }

  if (clauses.length === 0) {
    return undefined;
  }

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT id
       FROM app_usage_records
       WHERE
         user_id = ?
         AND (
           ${clauses.join(" OR ")}
         )
       ORDER BY
         created_at DESC
       LIMIT 1`,
      values
    );

  return rows[0]
    ? String(rows[0].id)
    : undefined;
}

function readProvider(
  value: string
):
  | ProviderId
  | HistoryProviderId
  | undefined {
  return (
    value === "lingke" ||
    value === "grsai" ||
    value === "nanobanana"
  )
    ? value
    : undefined;
}

function isOlderThan(
  value: Date,
  durationMs: number
): boolean {
  return (
    Date.now() -
      value.getTime()
  ) >= durationMs;
}

function readPositiveEnv(
  name: string,
  fallback: number,
  minimum: number
): number {
  const numeric =
    Number(
      process.env[name]
    );

  return (
    Number.isFinite(numeric) &&
    numeric >= minimum
  )
    ? Math.trunc(numeric)
    : fallback;
}

function readDate(
  value: unknown
): Date {
  if (value instanceof Date) {
    return value;
  }

  const normalized =
    typeof value === "string" &&
    !value.includes("T")
      ? `${value.replace(" ", "T")}Z`
      : String(value || "");

  const parsed =
    new Date(normalized);

  return Number.isNaN(
    parsed.getTime()
  )
    ? new Date()
    : parsed;
}

function centsToPoints(
  value: unknown
): number {
  const numeric =
    Number(value);

  return Number.isFinite(numeric)
    ? numeric / 100
    : 0;
}

function pointsToCents(
  value: number
): number {
  return Math.max(
    0,
    Math.round(
      (
        Number.isFinite(value)
          ? value
          : 0
      ) * 100
    )
  );
}

function optionalText(
  value: unknown
): string | undefined {
  return (
    typeof value === "string" &&
    value.length > 0
  )
    ? value
    : undefined;
}

function limitText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized =
    value.trim();

  return normalized
    ? normalized.slice(
        0,
        maxLength
      )
    : undefined;
}

function optionalInteger(
  value: number | undefined
): number | null {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? Math.max(
        0,
        Math.trunc(value)
      )
    : null;
}

function optionalNumber(
  value: number | undefined
): number | null {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  )
    ? value
    : null;
}

function errorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : "未知错误";
}
