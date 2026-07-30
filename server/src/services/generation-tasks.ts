import {
  randomUUID
} from "node:crypto";
import type {
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso
} from "../db/database.js";

export type GenerationTaskStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type GenerationTaskStatusFilter =
  | "all"
  | "active"
  | GenerationTaskStatus;

export interface GenerationTaskRecord {
  id: string;
  userId: string;
  provider: string;
  model: string;
  operation:
    | "text-to-image"
    | "image-edit";
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
  requestSnapshot?:
    Record<string, unknown>;
  thumbnailUrl?: string;
  providerProgress?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
}

export interface GenerationTaskQuery {
  page?: number;
  pageSize?: number;
  status?: GenerationTaskStatusFilter;
  provider?: string;
  model?: string;
  search?: string;
}

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

export interface GenerationTaskListResult {
  items: GenerationTaskRecord[];
  pagination: GenerationTaskPagination;
  summary: GenerationTaskSummary;
}

export interface CreateGenerationTaskInput {
  userId: string;
  batchItemId?: string;
  provider: string;
  model: string;
  operation:
    | "text-to-image"
    | "image-edit";
  size: string;
  prompt?: string;
  requestedImageCount: number;
  operationId?: string;
  reservedPoints?: number;
  requestSnapshot?:
    Record<string, unknown>;
  thumbnailDataUrl?: string;
}

export interface UpdateGenerationTaskInput {
  status?: GenerationTaskStatus;
  stage?: string;
  progress?: number;
  actualImageCount?: number;
  providerTaskId?: string;
  historyId?: string;
  actualPoints?: number;
  refundedPoints?: number;
  providerProgress?: string;
  errorCode?: string;
  errorMessage?: string;
  markStarted?: boolean;
  markCompleted?: boolean;
}

export async function createGenerationTask(
  database: AppDatabase,
  input: CreateGenerationTaskInput
): Promise<string> {
  const id = randomUUID();
  const now = new Date();

  await database.pool.execute(
    `INSERT INTO app_generation_tasks
      (id, user_id, batch_item_id, provider, model, operation, size, prompt, status, task_stage, progress,
       requested_image_count, actual_image_count, operation_id, reserved_points_cents,
       request_snapshot, thumbnail_data_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 5, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      limitText(
        input.batchItemId,
        36
      ) ?? null,
      limitText(
        input.provider,
        80
      ) || "unknown",
      limitText(
        input.model,
        160
      ) || "unknown",
      input.operation,
      limitText(
        input.size,
        80
      ) || "auto",
      limitText(
        input.prompt,
        5000
      ) ?? null,
      Math.max(
        1,
        Math.trunc(
          input.requestedImageCount
        ) || 1
      ),
      limitText(
        input.operationId,
        200
      ) ?? null,
      pointsToCents(
        input.reservedPoints
      ),
      input.requestSnapshot
        ? JSON.stringify(
            input.requestSnapshot
          )
        : null,
      normalizeThumbnail(
        input.thumbnailDataUrl
      ),
      now,
      now
    ]
  );

  return id;
}

export async function updateGenerationTask(
  database: AppDatabase,
  taskId: string | undefined,
  input: UpdateGenerationTaskInput
): Promise<void> {
  if (!taskId) return;

  const sets = [
    "updated_at = NOW(3)"
  ];

  const params:
    Array<string | number | null> = [];

  add("status", input.status);

  add(
    "task_stage",
    limitText(
      input.stage,
      40
    )
  );

  add(
    "progress",
    typeof input.progress === "number"
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(input.progress)
          )
        )
      : undefined
  );

  add(
    "actual_image_count",
    typeof input.actualImageCount ===
      "number"
      ? Math.max(
          0,
          Math.trunc(
            input.actualImageCount
          )
        )
      : undefined
  );

  add(
    "provider_task_id",
    limitText(
      input.providerTaskId,
      200
    )
  );

  add(
    "history_id",
    limitText(
      input.historyId,
      36
    )
  );

  add(
    "actual_points_cents",
    typeof input.actualPoints ===
      "number"
      ? pointsToCents(
          input.actualPoints
        )
      : undefined
  );

  add(
    "refunded_points_cents",
    typeof input.refundedPoints ===
      "number"
      ? pointsToCents(
          input.refundedPoints
        )
      : undefined
  );

  add(
    "provider_progress",
    limitText(
      input.providerProgress,
      300
    )
  );

  add(
    "error_code",
    limitText(
      input.errorCode,
      100
    )
  );

  add(
    "error_message",
    limitText(
      input.errorMessage,
      800
    )
  );

  if (input.markStarted) {
    sets.push(
      "started_at = COALESCE(started_at, NOW(3))"
    );
  }

  if (input.markCompleted) {
    sets.push(
      "completed_at = COALESCE(completed_at, NOW(3))"
    );
  }

  params.push(taskId);

  await database.pool.execute(
    `UPDATE app_generation_tasks
     SET ${sets.join(", ")}
     WHERE id = ?`,
    params
  );

  function add(
    column: string,
    value:
      | string
      | number
      | null
      | undefined
  ) {
    if (value === undefined) return;

    sets.push(
      `${column} = ?`
    );

    params.push(value);
  }
}

export async function queryGenerationTasks(
  database: AppDatabase,
  userId: string,
  query: GenerationTaskQuery = {}
): Promise<GenerationTaskListResult> {
  const page =
    positiveInteger(
      query.page,
      1,
      1,
      100_000
    );

  const pageSize =
    positiveInteger(
      query.pageSize,
      20,
      1,
      100
    );

  const status =
    normalizeStatusFilter(
      query.status
    );

  const provider =
    limitText(
      query.provider,
      80
    );

  const model =
    limitText(
      query.model,
      160
    );

  const search =
    limitText(
      query.search,
      200
    );

  const where = [
    "t.user_id = ?"
  ];

  const params:
    Array<string | number> = [
      userId
    ];

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
    params.push(status);
  }

  if (provider) {
    where.push(
      "t.provider = ?"
    );
    params.push(provider);
  }

  if (model) {
    where.push(
      "t.model = ?"
    );
    params.push(model);
  }

  if (search) {
    const pattern =
      `%${escapeLike(search)}%`;

    where.push(
      `(
        t.prompt LIKE ? ESCAPE '\\\\'
        OR t.model LIKE ? ESCAPE '\\\\'
        OR t.id LIKE ? ESCAPE '\\\\'
        OR t.provider_task_id LIKE ? ESCAPE '\\\\'
      )`
    );

    params.push(
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
      `SELECT COUNT(*) AS total
       FROM app_generation_tasks t
       WHERE ${whereSql}`,
      params
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
      RowDataPacket[]
    >(
      `SELECT
         t.*,
         i.image_url
           AS history_thumbnail_url
       FROM app_generation_tasks t
       LEFT JOIN app_history_images i
         ON
           i.history_id = t.history_id
           AND i.position_index = 0
       WHERE ${whereSql}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [
        ...params,
        pageSize,
        offset
      ]
    );

  const [summaryRows] =
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
           SUM(status = 'success'),
           0
         ) AS success,
         COALESCE(
           SUM(status = 'failed'),
           0
         ) AS failed,
         COALESCE(
           SUM(status = 'cancelled'),
           0
         ) AS cancelled
       FROM app_generation_tasks
       WHERE user_id = ?`,
      [userId]
    );

  const summaryRow =
    summaryRows[0] ||
    ({} as RowDataPacket);

  return {
    items:
      rows.map(
        toGenerationTask
      ),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages
    },
    summary: {
      total:
        Number(
          summaryRow.total || 0
        ),
      active:
        Number(
          summaryRow.active || 0
        ),
      success:
        Number(
          summaryRow.success || 0
        ),
      failed:
        Number(
          summaryRow.failed || 0
        ),
      cancelled:
        Number(
          summaryRow.cancelled || 0
        )
    }
  };
}

export async function listGenerationTasks(
  database: AppDatabase,
  userId: string,
  limit = 50
): Promise<GenerationTaskRecord[]> {
  const result =
    await queryGenerationTasks(
      database,
      userId,
      {
        page: 1,
        pageSize: limit
      }
    );

  return result.items;
}

export async function getGenerationTaskById(
  database: AppDatabase,
  userId: string,
  taskId: string
): Promise<GenerationTaskRecord | undefined> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         t.*,
         i.image_url
           AS history_thumbnail_url
       FROM app_generation_tasks t
       LEFT JOIN app_history_images i
         ON
           i.history_id = t.history_id
           AND i.position_index = 0
       WHERE
         t.id = ?
         AND t.user_id = ?
       LIMIT 1`,
      [
        taskId,
        userId
      ]
    );

  return rows[0]
    ? toGenerationTask(
        rows[0]
      )
    : undefined;
}

export async function findGenerationTaskByProviderTaskId(
  database: AppDatabase,
  userId: string,
  providerTaskId: string
): Promise<GenerationTaskRecord | undefined> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         t.*,
         i.image_url
           AS history_thumbnail_url
       FROM app_generation_tasks t
       LEFT JOIN app_history_images i
         ON
           i.history_id = t.history_id
           AND i.position_index = 0
       WHERE
         t.user_id = ?
         AND t.provider_task_id = ?
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [
        userId,
        providerTaskId
      ]
    );

  return rows[0]
    ? toGenerationTask(
        rows[0]
      )
    : undefined;
}

export async function linkGenerationTaskHistory(
  database: AppDatabase,
  userId: string,
  taskId: string,
  historyId: string
): Promise<boolean> {
  const [result] =
    await database.pool.execute(
      `UPDATE app_generation_tasks
       SET
         history_id = ?,
         updated_at = NOW(3)
       WHERE
         id = ?
         AND user_id = ?`,
      [
        historyId,
        taskId,
        userId
      ]
    );

  return Number(
    (
      result as {
        affectedRows?: number
      }
    ).affectedRows || 0
  ) > 0;
}

export function parseProviderProgress(
  value: string | undefined,
  fallback: number
): number {
  const match =
    value?.match(
      /(\d{1,3}(?:\.\d+)?)\s*%/
    );

  if (!match) return fallback;

  return Math.max(
    0,
    Math.min(
      99,
      Number(match[1])
    )
  );
}

function toGenerationTask(
  row: RowDataPacket
): GenerationTaskRecord {
  return {
    id:
      String(row.id),
    userId:
      String(row.user_id),
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
      optionalText(row.prompt),
    status:
      normalizeStatus(
        row.status
      ),
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
      Number(
        row.requested_image_count ||
        0
      ),
    actualImageCount:
      Number(
        row.actual_image_count ||
        0
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
    actualPoints:
      centsToPoints(
        row.actual_points_cents
      ),
    refundedPoints:
      centsToPoints(
        row.refunded_points_cents
      ) || 0,
    requestSnapshot:
      parseSnapshot(
        row.request_snapshot
      ),
    thumbnailUrl:
      optionalText(
        row.history_thumbnail_url
      ) ||
      optionalText(
        row.thumbnail_data_url
      ),
    providerProgress:
      optionalText(
        row.provider_progress
      ),
    errorCode:
      optionalText(
        row.error_code
      ),
    errorMessage:
      optionalText(
        row.error_message
      ),
    createdAt:
      mysqlDateToIso(
        row.created_at
      ) ||
      new Date().toISOString(),
    startedAt:
      mysqlDateToIso(
        row.started_at
      ),
    updatedAt:
      mysqlDateToIso(
        row.updated_at
      ) ||
      new Date().toISOString(),
    completedAt:
      mysqlDateToIso(
        row.completed_at
      )
  };
}

function normalizeStatus(
  value: unknown
): GenerationTaskStatus {
  return (
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  )
    ? value
    : "queued";
}

function normalizeStatusFilter(
  value: unknown
): GenerationTaskStatusFilter {
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

function parseSnapshot(
  value: unknown
): Record<string, unknown> | undefined {
  if (
    value &&
    typeof value === "object"
  ) {
    return value as
      Record<string, unknown>;
  }

  if (
    typeof value !== "string" ||
    !value
  ) {
    return undefined;
  }

  try {
    const parsed =
      JSON.parse(value);

    return (
      parsed &&
      typeof parsed === "object"
    )
      ? parsed as
          Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeThumbnail(
  value: string | undefined
): string | null {
  if (
    !value ||
    !value.startsWith(
      "data:image/"
    )
  ) {
    return null;
  }

  return value.length <= 700_000
    ? value
    : null;
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

function optionalText(
  value: unknown
): string | undefined {
  return (
    typeof value === "string" &&
    value.length
  )
    ? value
    : undefined;
}

function pointsToCents(
  value: number | undefined
): number | null {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? Math.max(
        0,
        Math.round(
          value * 100
        )
      )
    : null;
}

function centsToPoints(
  value: unknown
): number | undefined {
  if (
    value === null ||
    value === undefined
  ) {
    return undefined;
  }

  const numeric =
    Number(value);

  return Number.isFinite(numeric)
    ? numeric / 100
    : undefined;
}

function positiveInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const numeric =
    Number(value);

  if (
    !Number.isInteger(numeric)
  ) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(
      maximum,
      numeric
    )
  );
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
