import {
  randomUUID
} from "node:crypto";
import type {
  RowDataPacket
} from "mysql2/promise";
import {
  AuthError,
  type AuthService
} from "../auth.js";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso
} from "../db/database.js";

export type AdminTaskStatusFilter =
  | "all"
  | "active"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface AdminTaskQuery {
  page?: number;
  pageSize?: number;
  status?: AdminTaskStatusFilter;
  provider?: string;
  search?: string;
  staleOnly?: boolean;
}

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

export interface AdminTaskListResult {
  items: AdminTaskRecord[];
  pagination:
    AdminTaskPagination;
  summary:
    AdminTaskSummary;
}

interface AdminTaskRow
  extends RowDataPacket {
  id: string;
  user_id: string;
  username: string;
  provider: string;
  model: string;
  operation: string;
  size: string;
  prompt: string | null;
  status: string;
  task_stage: string;
  progress: number;
  requested_image_count: number;
  actual_image_count: number;
  provider_task_id: string | null;
  operation_id: string | null;
  history_id: string | null;
  reserved_points_cents:
    number | null;
  actual_points_cents:
    number | null;
  refunded_points_cents:
    number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  stale_flag: number;
}

export async function queryAdminTasks(
  database: AppDatabase,
  query: AdminTaskQuery = {}
): Promise<AdminTaskListResult> {
  const page =
    boundedInteger(
      query.page,
      1,
      1,
      100_000
    );

  const pageSize =
    boundedInteger(
      query.pageSize,
      20,
      5,
      100
    );

  const status =
    normalizeStatusFilter(
      query.status
    );

  const provider =
    normalizeText(
      query.provider,
      80
    );

  const search =
    normalizeText(
      query.search,
      200
    );

  const staleMs =
    readPositiveEnv(
      "GENERATION_ADMIN_STALE_MS",
      10 * 60_000,
      60_000
    );

  const staleBefore =
    new Date(
      Date.now() - staleMs
    );

  const where: string[] = [
    "1 = 1"
  ];

  const values:
    Array<
      string |
      number |
      Date
    > = [];

  if (status === "active") {
    where.push(
      "t.status IN ('queued','running')"
    );
  } else if (
    status !== "all"
  ) {
    where.push(
      "t.status = ?"
    );

    values.push(status);
  }

  if (provider) {
    where.push(
      "t.provider = ?"
    );

    values.push(provider);
  }

  if (query.staleOnly) {
    where.push(
      "t.status IN ('queued','running')"
    );

    where.push(
      "t.updated_at < ?"
    );

    values.push(
      staleBefore
    );
  }

  if (search) {
    const pattern =
      `%${escapeLike(search)}%`;

    where.push(
      `(
        u.username LIKE ? ESCAPE '\\\\'
        OR t.prompt LIKE ? ESCAPE '\\\\'
        OR t.model LIKE ? ESCAPE '\\\\'
        OR t.id LIKE ? ESCAPE '\\\\'
        OR t.provider_task_id LIKE ? ESCAPE '\\\\'
      )`
    );

    values.push(
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    );
  }

  const whereSql =
    where.join(" AND ");

  const [countRows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         COUNT(*) AS total
       FROM app_generation_tasks t
       INNER JOIN app_users u
         ON u.id = t.user_id
       WHERE ${whereSql}`,
      values
    );

  const total =
    Number(
      countRows[0]?.total || 0
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total / pageSize
      )
    );

  const safePage =
    Math.min(
      page,
      totalPages
    );

  const offset =
    (safePage - 1) *
    pageSize;

  const [rows] =
    await database.pool.query<
      AdminTaskRow[]
    >(
      `SELECT
         t.*,
         u.username,
         TIMESTAMPDIFF(
           MICROSECOND,
           COALESCE(
             t.started_at,
             t.created_at
           ),
           COALESCE(
             t.completed_at,
             NOW(3)
           )
         ) / 1000 AS duration_ms,
         CASE
           WHEN
             t.status IN ('queued','running')
             AND t.updated_at < ?
           THEN 1
           ELSE 0
         END AS stale_flag
       FROM app_generation_tasks t
       INNER JOIN app_users u
         ON u.id = t.user_id
       WHERE ${whereSql}
       ORDER BY
         t.created_at DESC
       LIMIT ? OFFSET ?`,
      [
        staleBefore,
        ...values,
        pageSize,
        offset
      ]
    );

  return {
    items:
      rows.map(
        mapAdminTask
      ),
    pagination: {
      page:
        safePage,
      pageSize,
      total,
      totalPages
    },
    summary:
      await readAdminTaskSummary(
        database,
        staleBefore
      )
  };
}

export async function readAdminTaskHealth(
  database: AppDatabase
): Promise<{
  summary: AdminTaskSummary;
  models:
    AdminModelTaskHealth[];
}> {
  const staleMs =
    readPositiveEnv(
      "GENERATION_ADMIN_STALE_MS",
      10 * 60_000,
      60_000
    );

  const staleBefore =
    new Date(
      Date.now() - staleMs
    );

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         provider,
         model,
         COUNT(*) AS total,
         COALESCE(
           SUM(
             status IN ('queued','running')
           ),
           0
         ) AS active,
         COALESCE(
           SUM(status = 'success'),
           0
         ) AS success,
         COALESCE(
           SUM(status = 'failed'),
           0
         ) AS failed,
         COALESCE(
           AVG(
             CASE
               WHEN
                 status IN ('success','failed')
                 AND completed_at IS NOT NULL
               THEN TIMESTAMPDIFF(
                 MICROSECOND,
                 COALESCE(
                   started_at,
                   created_at
                 ),
                 completed_at
               ) / 1000
               ELSE NULL
             END
           ),
           0
         ) AS average_duration_ms,
         MAX(created_at)
           AS last_task_at
       FROM app_generation_tasks
       WHERE
         created_at >=
           DATE_SUB(
             NOW(3),
             INTERVAL 30 DAY
           )
       GROUP BY
         provider,
         model
       ORDER BY
         total DESC,
         provider ASC,
         model ASC`
    );

  return {
    summary:
      await readAdminTaskSummary(
        database,
        staleBefore
      ),
    models:
      rows.map(
        (row) => {
          const success =
            Number(
              row.success || 0
            );

          const failed =
            Number(
              row.failed || 0
            );

          const terminal =
            success + failed;

          return {
            provider:
              String(row.provider),
            model:
              String(row.model),
            total:
              Number(
                row.total || 0
              ),
            active:
              Number(
                row.active || 0
              ),
            success,
            failed,
            successRate:
              terminal > 0
                ? Number(
                    (
                      success /
                      terminal *
                      100
                    ).toFixed(1)
                  )
                : 0,
            averageDurationMs:
              Math.max(
                0,
                Math.round(
                  Number(
                    row.average_duration_ms ||
                    0
                  )
                )
              ),
            lastTaskAt:
              mysqlDateToIso(
                row.last_task_at
              )
          };
        }
      )
  };
}

export async function failAndRefundAdminTask(
  database: AppDatabase,
  authService: AuthService,
  taskId: string,
  reason: string
): Promise<{
  task: AdminTaskRecord;
  refundedPoints: number;
}> {
  const normalizedReason =
    normalizeText(
      reason,
      500
    ) ||
    "站长手动终止异常任务";

  const [rows] =
    await database.pool.query<
      AdminTaskRow[]
    >(
      `SELECT
         t.*,
         u.username,
         TIMESTAMPDIFF(
           MICROSECOND,
           COALESCE(
             t.started_at,
             t.created_at
           ),
           COALESCE(
             t.completed_at,
             NOW(3)
           )
         ) / 1000 AS duration_ms,
         0 AS stale_flag
       FROM app_generation_tasks t
       INNER JOIN app_users u
         ON u.id = t.user_id
       WHERE t.id = ?
       LIMIT 1`,
      [taskId]
    );

  const row =
    rows[0];

  if (!row) {
    throw new AuthError(
      404,
      "TASK_NOT_FOUND",
      "生成任务不存在"
    );
  }

  if (
    row.status === "success"
  ) {
    throw new AuthError(
      409,
      "TASK_ALREADY_SUCCESS",
      "成功任务不能执行失败退款"
    );
  }

  if (row.history_id) {
    throw new AuthError(
      409,
      "TASK_HAS_HISTORY",
      "任务已经保存生成结果，请先运行恢复扫描完成正常结算"
    );
  }

  if (
    row.status !== "queued" &&
    row.status !== "running" &&
    row.status !== "failed"
  ) {
    throw new AuthError(
      409,
      "TASK_NOT_REFUNDABLE",
      "当前任务状态不能执行失败退款"
    );
  }

  const operationId =
    optionalString(
      row.operation_id
    );

  const settlement =
    operationId
      ? await authService
          .settleGenerationCredits(
            String(row.user_id),
            operationId,
            0,
            normalizedReason
          )
      : {
          balance: 0,
          pointsCost: 0,
          refunded: false,
          refundAmount: 0
        };

  const completedAt =
    new Date();

  await database.pool.execute(
    `UPDATE app_generation_tasks
     SET
       status = 'failed',
       task_stage = ?,
       progress = 100,
       actual_image_count = 0,
       actual_points_cents = ?,
       refunded_points_cents = ?,
       provider_progress = ?,
       error_code =
         'ADMIN_FAILED_REFUND',
       error_message = ?,
       updated_at = ?,
       completed_at =
         COALESCE(
           completed_at,
           ?
         )
     WHERE id = ?`,
    [
      settlement.refundAmount > 0
        ? "refunded"
        : "failed",
      Math.round(
        settlement.pointsCost *
        100
      ),
      Math.round(
        settlement.refundAmount *
        100
      ),
      settlement.refundAmount > 0
        ? "站长已终止任务并退回积分"
        : "站长已终止任务",
      normalizedReason,
      completedAt,
      completedAt,
      taskId
    ]
  );

  const usageClauses:
    string[] = [];

  const usageValues:
    string[] = [];

  if (operationId) {
    usageClauses.push(
      "operation_id = ?"
    );

    usageValues.push(
      operationId
    );
  }

  const providerTaskId =
    optionalString(
      row.provider_task_id
    );

  if (providerTaskId) {
    usageClauses.push(
      "request_id = ?"
    );

    usageValues.push(
      providerTaskId
    );
  }

  if (usageClauses.length > 0) {
    const [result] =
      await database.pool.execute(
        `UPDATE app_usage_records
         SET
           status = 'failed',
           image_count = 0,
           points_cost_cents = ?,
           points_refunded = ?,
           error = ?
         WHERE
           user_id = ?
           AND (
             ${usageClauses.join(" OR ")}
           )`,
        [
          Math.round(
            settlement.pointsCost *
            100
          ),
          settlement.refundAmount > 0
            ? 1
            : 0,
          normalizedReason,
          String(row.user_id),
          ...usageValues
        ]
      );

    const affectedRows =
      Number(
        (
          result as {
            affectedRows?: number
          }
        ).affectedRows || 0
      );

    if (affectedRows === 0) {
      await insertFailedUsage(
        database,
        row,
        normalizedReason,
        settlement.pointsCost,
        settlement.refundAmount > 0
      );
    }
  } else {
    await insertFailedUsage(
      database,
      row,
      normalizedReason,
      settlement.pointsCost,
      settlement.refundAmount > 0
    );
  }

  const [updatedRows] =
    await database.pool.query<
      AdminTaskRow[]
    >(
      `SELECT
         t.*,
         u.username,
         TIMESTAMPDIFF(
           MICROSECOND,
           COALESCE(
             t.started_at,
             t.created_at
           ),
           COALESCE(
             t.completed_at,
             NOW(3)
           )
         ) / 1000 AS duration_ms,
         0 AS stale_flag
       FROM app_generation_tasks t
       INNER JOIN app_users u
         ON u.id = t.user_id
       WHERE t.id = ?
       LIMIT 1`,
      [taskId]
    );

  return {
    task:
      mapAdminTask(
        updatedRows[0] ||
        row
      ),
    refundedPoints:
      settlement.refundAmount
  };
}

async function readAdminTaskSummary(
  database: AppDatabase,
  staleBefore: Date
): Promise<AdminTaskSummary> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         COUNT(*) AS total,
         COALESCE(
           SUM(
             status IN ('queued','running')
           ),
           0
         ) AS active,
         COALESCE(
           SUM(
             status IN ('queued','running')
             AND updated_at < ?
           ),
           0
         ) AS stale,
         COALESCE(
           SUM(
             status = 'success'
             AND created_at >=
               DATE_SUB(
                 NOW(3),
                 INTERVAL 24 HOUR
               )
           ),
           0
         ) AS success_24h,
         COALESCE(
           SUM(
             status = 'failed'
             AND created_at >=
               DATE_SUB(
                 NOW(3),
                 INTERVAL 24 HOUR
               )
           ),
           0
         ) AS failed_24h,
         COALESCE(
           SUM(
             CASE
               WHEN
                 completed_at >=
                   DATE_SUB(
                     NOW(3),
                     INTERVAL 24 HOUR
                   )
               THEN refunded_points_cents
               ELSE 0
             END
           ),
           0
         ) AS refunded_24h_cents,
         COALESCE(
           AVG(
             CASE
               WHEN
                 completed_at >=
                   DATE_SUB(
                     NOW(3),
                     INTERVAL 24 HOUR
                   )
                 AND status IN (
                   'success',
                   'failed'
                 )
               THEN TIMESTAMPDIFF(
                 MICROSECOND,
                 COALESCE(
                   started_at,
                   created_at
                 ),
                 completed_at
               ) / 1000
               ELSE NULL
             END
           ),
           0
         ) AS average_duration_24h_ms
       FROM app_generation_tasks`,
      [staleBefore]
    );

  const row =
    rows[0] ||
    ({} as RowDataPacket);

  return {
    total:
      Number(
        row.total || 0
      ),
    active:
      Number(
        row.active || 0
      ),
    stale:
      Number(
        row.stale || 0
      ),
    success24h:
      Number(
        row.success_24h || 0
      ),
    failed24h:
      Number(
        row.failed_24h || 0
      ),
    refundedPoints24h:
      centsToPoints(
        row.refunded_24h_cents
      ),
    averageDurationMs24h:
      Math.max(
        0,
        Math.round(
          Number(
            row.average_duration_24h_ms ||
            0
          )
        )
      )
  };
}

async function insertFailedUsage(
  database: AppDatabase,
  row: AdminTaskRow,
  reason: string,
  pointsCost: number,
  pointsRefunded: boolean
): Promise<void> {
  await database.pool.execute(
    `INSERT INTO app_usage_records
      (id, user_id, username, created_at, provider, model, operation, size, prompt,
       image_count, status, duration_ms, cost, request_id, operation_id,
       points_cost_cents, points_refunded, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'failed', NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      String(row.user_id),
      String(row.username),
      readDate(row.created_at),
      String(row.provider),
      String(row.model),
      row.operation === "image-edit"
        ? "image-edit"
        : "text-to-image",
      String(row.size),
      optionalString(
        row.prompt
      ) ?? null,
      optionalString(
        row.provider_task_id
      ) ?? null,
      optionalString(
        row.operation_id
      ) ?? null,
      Math.round(
        pointsCost * 100
      ),
      pointsRefunded
        ? 1
        : 0,
      reason
    ]
  );
}

function mapAdminTask(
  row: AdminTaskRow
): AdminTaskRecord {
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
      optionalString(
        row.prompt
      ),
    status:
      normalizeTaskStatus(
        row.status
      ),
    stage:
      String(
        row.task_stage ||
        "queued"
      ),
    progress:
      clampNumber(
        row.progress,
        0,
        100
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
    providerTaskId:
      optionalString(
        row.provider_task_id
      ),
    operationId:
      optionalString(
        row.operation_id
      ),
    historyId:
      optionalString(
        row.history_id
      ),
    reservedPoints:
      centsToPoints(
        row.reserved_points_cents
      ),
    actualPoints:
      centsToPoints(
        row.actual_points_cents
      ),
    refundedPoints:
      centsToPoints(
        row.refunded_points_cents
      ),
    createdAt:
      mysqlDateToIso(
        row.created_at
      ) ||
      new Date().toISOString(),
    updatedAt:
      mysqlDateToIso(
        row.updated_at
      ) ||
      new Date().toISOString(),
    startedAt:
      mysqlDateToIso(
        row.started_at
      ),
    completedAt:
      mysqlDateToIso(
        row.completed_at
      ),
    durationMs:
      Math.max(
        0,
        Math.round(
          Number(
            row.duration_ms || 0
          )
        )
      ),
    stale:
      Number(
        row.stale_flag || 0
      ) > 0,
    errorCode:
      optionalString(
        row.error_code
      ),
    errorMessage:
      optionalString(
        row.error_message
      )
  };
}

function normalizeTaskStatus(
  value: unknown
): AdminTaskRecord["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  )
    ? value
    : "failed";
}

function normalizeStatusFilter(
  value: unknown
): AdminTaskStatusFilter {
  return (
    value === "active" ||
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  )
    ? value
    : "all";
}

function normalizeText(
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

function optionalString(
  value: unknown
): string | undefined {
  return (
    typeof value === "string" &&
    value.length > 0
  )
    ? value
    : undefined;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const numeric =
    Number(value);

  return Number.isInteger(numeric)
    ? Math.min(
        maximum,
        Math.max(
          minimum,
          numeric
        )
      )
    : fallback;
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number
): number {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return minimum;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      numeric
    )
  );
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

function escapeLike(
  value: string
): string {
  return value.replace(
    /[\\%_]/g,
    (match) =>
      `\\${match}`
  );
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

  const date =
    new Date(normalized);

  return Number.isNaN(
    date.getTime()
  )
    ? new Date()
    : date;
}
