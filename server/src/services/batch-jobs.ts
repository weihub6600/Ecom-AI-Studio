import {
  randomUUID
} from "node:crypto";
import {
  lookup
} from "node:dns/promises";
import {
  isIP
} from "node:net";
import type {
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import {
  AUTH_COOKIE_NAME,
  AuthError
} from "../auth.js";
import {
  createSessionToken
} from "../auth/helpers.js";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso,
  withTransaction
} from "../db/database.js";
import type {
  ModelSettingsService
} from "./model-settings.js";
import {
  createWorkLibraryService,
  type WorkLibraryService
} from "./work-library.js";

export type BatchJobStatus =
  | "draft"
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "completed"
  | "cancelled";

export type BatchItemStatus =
  | "queued"
  | "running"
  | "success"
  | "failed";

export interface BatchItemInput {
  productName?: unknown;
  prompt?: unknown;
  negativePrompt?: unknown;
  provider?: unknown;
  model?: unknown;
  size?: unknown;
  count?: unknown;
  referenceImageUrl?: unknown;
}

export interface CreateBatchInput {
  name?: unknown;
  rows?: unknown;
}

export interface BatchTemplateColumnMapping {
  productName?: string;
  prompt?: string;
  negativePrompt?: string;
  provider?: string;
  model?: string;
  size?: string;
  count?: string;
  referenceImageUrl?: string;
}

export interface BatchTemplateInput {
  name?: unknown;
  description?: unknown;
  provider?: unknown;
  model?: unknown;
  size?: unknown;
  count?: unknown;
  promptTemplate?: unknown;
  negativePromptTemplate?: unknown;
  referenceImageUrl?: unknown;
  columnMapping?: unknown;
}

export interface CloneBatchInput {
  name?: unknown;
  start?: unknown;
}

export interface BatchTemplateRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  provider: string;
  model: string;
  size: string;
  count: number;
  promptTemplate: string;
  negativePromptTemplate?: string;
  referenceImageUrl?: string;
  columnMapping: BatchTemplateColumnMapping;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface BatchImage {
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface BatchItemRecord {
  id: string;
  position: number;
  productName: string;
  prompt: string;
  negativePrompt?: string;
  provider: string;
  model: string;
  operation:
    | "text-to-image"
    | "image-edit";
  size: string;
  count: number;
  referenceImageUrl?: string;
  status: BatchItemStatus;
  progress?: string;
  error?: string;
  warning?: string;
  generationTaskId?: string;
  providerTaskId?: string;
  historyId?: string;
  pointsCost: number;
  attempts: number;
  images: BatchImage[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BatchJobRecord {
  id: string;
  userId: string;
  username: string;
  name: string;
  folderId?: string;
  status: BatchJobStatus;
  totalItems: number;
  successItems: number;
  failedItems: number;
  runningItems: number;
  queuedItems: number;
  progress: number;
  estimatedPoints: number;
  actualPoints: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  items?: BatchItemRecord[];
}

interface InternalGenerationResult {
  provider: string;
  model: string;
  images: BatchImage[];
  durationMs: number;
  requestId?: string;
  taskId?: string;
  status?:
    | "pending"
    | "processing"
    | "completed"
    | "failed";
  progress?: string;
  cost?: number;
  error?: string;
}

interface InternalGenerationPayload {
  result: InternalGenerationResult;
  credits?: number;
  pointsCost?: number;
  refundAmount?: number;
  taskRecordId?: string;
  historyRecord?: {
    id: string;
    images?: BatchImage[];
  };
}

interface GenerationTaskRow extends RowDataPacket {
  id: string;
  status: string;
  provider_task_id: string | null;
  history_id: string | null;
  actual_points_cents: number | null;
  refunded_points_cents: number | null;
  error_message: string | null;
  provider_progress: string | null;
  updated_at: Date | string;
}

class InternalApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    status: number,
    message: string,
    code?: string
  ) {
    super(message);
    this.name = "InternalApiError";
    this.status = status;
    this.code = code;
  }
}

export function createBatchJobService(options: {
  database: AppDatabase;
  modelSettingsService:
    ModelSettingsService;
  baseUrl: string;
}) {
  const {
    database,
    modelSettingsService,
    baseUrl
  } = options;

  const {
    pool
  } = database;

  const library:
    WorkLibraryService =
      createWorkLibraryService(
        database
      );

  const workerSecret =
    randomUUID();

  let initialized:
    Promise<void> |
    undefined;

  let workerTimer:
    ReturnType<typeof setInterval> |
    undefined;

  let workerBusy = false;
  let stopped = false;

  function initialize():
    Promise<void> {
    if (!initialized) {
      initialized =
        initializeSchema().catch(
          (error) => {
            initialized = undefined;
            throw error;
          }
        );
    }

    return initialized;
  }

  async function initializeSchema():
    Promise<void> {
    const collation =
      await resolveCoreCollation();

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_batch_jobs (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        batch_name VARCHAR(120) NOT NULL,
        folder_id CHAR(36) NULL,
        status ENUM(
          'draft','queued','running','pausing',
          'paused','completed','cancelled'
        ) NOT NULL DEFAULT 'draft',
        total_items INT UNSIGNED NOT NULL DEFAULT 0,
        success_items INT UNSIGNED NOT NULL DEFAULT 0,
        failed_items INT UNSIGNED NOT NULL DEFAULT 0,
        estimated_points_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
        actual_points_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
        last_error VARCHAR(800) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        started_at DATETIME(3) NULL,
        completed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY idx_app_batch_user_created (user_id, created_at),
        KEY idx_app_batch_status_updated (status, updated_at),
        CONSTRAINT fk_app_batch_user
          FOREIGN KEY (user_id) REFERENCES app_users(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_batch_items (
        id CHAR(36) NOT NULL,
        batch_id CHAR(36) NOT NULL,
        position_index INT UNSIGNED NOT NULL,
        product_name VARCHAR(160) NOT NULL,
        prompt TEXT NOT NULL,
        negative_prompt TEXT NULL,
        provider VARCHAR(80) NOT NULL,
        model VARCHAR(160) NOT NULL,
        operation ENUM('text-to-image','image-edit') NOT NULL,
        size VARCHAR(80) NOT NULL,
        image_count INT UNSIGNED NOT NULL,
        reference_image_url VARCHAR(2000) NULL,
        status ENUM('queued','running','success','failed') NOT NULL DEFAULT 'queued',
        progress VARCHAR(300) NULL,
        error_message VARCHAR(800) NULL,
        warning_message VARCHAR(800) NULL,
        generation_task_id CHAR(36) NULL,
        provider_task_id VARCHAR(200) NULL,
        history_id CHAR(36) NULL,
        points_cost_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        started_at DATETIME(3) NULL,
        completed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_app_batch_item_position (batch_id, position_index),
        KEY idx_app_batch_item_status (batch_id, status, position_index),
        KEY idx_app_batch_item_task (generation_task_id),
        KEY idx_app_batch_item_history (history_id),
        CONSTRAINT fk_app_batch_item_batch
          FOREIGN KEY (batch_id) REFERENCES app_batch_jobs(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_batch_templates (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        template_name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        provider VARCHAR(80) NOT NULL,
        model VARCHAR(160) NOT NULL,
        size VARCHAR(80) NOT NULL,
        image_count INT UNSIGNED NOT NULL DEFAULT 1,
        prompt_template TEXT NOT NULL,
        negative_prompt_template TEXT NULL,
        reference_image_url VARCHAR(2000) NULL,
        column_mapping_json JSON NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        last_used_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_app_batch_template_name (user_id, template_name),
        KEY idx_app_batch_template_updated (user_id, updated_at),
        KEY idx_app_batch_template_used (user_id, last_used_at),
        CONSTRAINT fk_app_batch_template_user
          FOREIGN KEY (user_id) REFERENCES app_users(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );

    await ensureGenerationTaskBatchColumn();
    await library.initialize();
  }

  async function ensureGenerationTaskBatchColumn():
    Promise<void> {
    const [columns] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE
           TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'app_generation_tasks'
           AND COLUMN_NAME = 'batch_item_id'
         LIMIT 1`
      );

    if (columns.length === 0) {
      await pool.query(
        `ALTER TABLE app_generation_tasks
         ADD COLUMN batch_item_id CHAR(36) NULL AFTER user_id`
      );
    }

    const [indexes] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT INDEX_NAME
         FROM information_schema.STATISTICS
         WHERE
           TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'app_generation_tasks'
           AND INDEX_NAME = 'idx_app_generation_batch_item'
         LIMIT 1`
      );

    if (indexes.length === 0) {
      await pool.query(
        `ALTER TABLE app_generation_tasks
         ADD KEY idx_app_generation_batch_item (batch_item_id)`
      );
    }
  }

  async function resolveCoreCollation():
    Promise<string> {
    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE
           TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'app_users'
           AND COLUMN_NAME = 'id'
         LIMIT 1`
      );

    const value =
      rows[0]?.COLLATION_NAME;

    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_]+$/.test(value)
    ) {
      throw new Error(
        "无法读取批次表所需的 MySQL 排序规则"
      );
    }

    return value;
  }

  async function listJobs(
    userId: string,
    allUsers = false
  ): Promise<BatchJobRecord[]> {
    await initialize();

    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           b.*,
           u.username,
           COALESCE(SUM(i.status = 'running'), 0) AS running_items,
           COALESCE(SUM(i.status = 'queued'), 0) AS queued_items
         FROM app_batch_jobs b
         INNER JOIN app_users u
           ON u.id = b.user_id
         LEFT JOIN app_batch_items i
           ON i.batch_id = b.id
         ${allUsers ? "" : "WHERE b.user_id = ?"}
         GROUP BY b.id, u.username
         ORDER BY b.created_at DESC
         LIMIT 200`,
        allUsers
          ? []
          : [userId]
      );

    return rows.map(
      mapJob
    );
  }

  async function readJob(
    requesterUserId: string,
    jobId: string,
    allUsers = false
  ): Promise<BatchJobRecord> {
    await initialize();

    const [jobRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           b.*,
           u.username,
           COALESCE(SUM(i.status = 'running'), 0) AS running_items,
           COALESCE(SUM(i.status = 'queued'), 0) AS queued_items
         FROM app_batch_jobs b
         INNER JOIN app_users u
           ON u.id = b.user_id
         LEFT JOIN app_batch_items i
           ON i.batch_id = b.id
         WHERE
           b.id = ?
           ${allUsers ? "" : "AND b.user_id = ?"}
         GROUP BY b.id, u.username
         LIMIT 1`,
        allUsers
          ? [jobId]
          : [jobId, requesterUserId]
      );

    const row = jobRows[0];

    if (!row) {
      throw new AuthError(
        404,
        "BATCH_NOT_FOUND",
        "批次不存在"
      );
    }

    const [itemRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_items
         WHERE batch_id = ?
         ORDER BY position_index ASC`,
        [jobId]
      );

    const historyIds =
      itemRows
        .map((item) =>
          optionalText(
            item.history_id
          )
        )
        .filter(
          (value): value is string =>
            Boolean(value)
        );

    const imageMap =
      await readImages(historyIds);

    return {
      ...mapJob(row),
      items:
        itemRows.map(
          (item) =>
            mapItem(
              item,
              imageMap.get(
                String(
                  item.history_id || ""
                )
              ) || []
            )
        )
    };
  }

  async function createJob(
    userId: string,
    input: CreateBatchInput
  ): Promise<BatchJobRecord> {
    await initialize();

    const name =
      normalizeText(
        input.name,
        120
      ) ||
      createDefaultBatchName();

    if (!Array.isArray(input.rows)) {
      throw new AuthError(
        400,
        "BATCH_ROWS_REQUIRED",
        "请导入至少一条商品任务"
      );
    }

    if (
      input.rows.length < 1 ||
      input.rows.length > 200
    ) {
      throw new AuthError(
        400,
        "BATCH_ROWS_LIMIT",
        "单个批次需要 1–200 条商品任务"
      );
    }

    const normalizedRows =
      input.rows.map(
        (row, index) =>
          normalizeRow(
            row as BatchItemInput,
            index
          )
      );

    const estimatedPoints =
      normalizedRows.reduce(
        (sum, row) =>
          sum + row.unitPoints * row.count,
        0
      );

    const folderId =
      await ensureFolder(
        userId,
        name
      );

    const id = randomUUID();
    const now = new Date();

    await withTransaction(
      pool,
      async (connection) => {
        await connection.execute(
          `INSERT INTO app_batch_jobs
            (id, user_id, batch_name, folder_id, status, total_items,
             success_items, failed_items, estimated_points_cents,
             actual_points_cents, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, 0, 0, ?, 0, ?, ?)`,
          [
            id,
            userId,
            name,
            folderId ?? null,
            normalizedRows.length,
            pointsToCents(
              estimatedPoints
            ),
            now,
            now
          ]
        );

        for (
          let index = 0;
          index < normalizedRows.length;
          index += 1
        ) {
          const row =
            normalizedRows[index];

          if (!row) continue;

          await connection.execute(
            `INSERT INTO app_batch_items
              (id, batch_id, position_index, product_name, prompt,
               negative_prompt, provider, model, operation, size,
               image_count, reference_image_url, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
            [
              randomUUID(),
              id,
              index,
              row.productName,
              row.prompt,
              row.negativePrompt ?? null,
              row.provider,
              row.model,
              row.operation,
              row.size,
              row.count,
              row.referenceImageUrl ?? null,
              now,
              now
            ]
          );
        }
      }
    );

    return readJob(
      userId,
      id
    );
  }

  async function listTemplates(
    userId: string
  ): Promise<BatchTemplateRecord[]> {
    await initialize();

    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_templates
         WHERE user_id = ?
         ORDER BY
           COALESCE(last_used_at, updated_at) DESC,
           template_name ASC
         LIMIT 200`,
        [userId]
      );

    return rows.map(
      mapTemplate
    );
  }

  async function createTemplate(
    userId: string,
    input: BatchTemplateInput
  ): Promise<BatchTemplateRecord> {
    await initialize();

    const normalized =
      normalizeTemplateInput(input);

    const [existing] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT id
         FROM app_batch_templates
         WHERE
           user_id = ?
           AND template_name = ?
         LIMIT 1`,
        [
          userId,
          normalized.name
        ]
      );

    if (existing.length > 0) {
      throw new AuthError(
        409,
        "BATCH_TEMPLATE_EXISTS",
        "同名商品模板已经存在"
      );
    }

    const id = randomUUID();
    const now = new Date();

    await pool.execute(
      `INSERT INTO app_batch_templates
        (id, user_id, template_name, description, provider, model,
         size, image_count, prompt_template, negative_prompt_template,
         reference_image_url, column_mapping_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        normalized.name,
        normalized.description ?? null,
        normalized.provider,
        normalized.model,
        normalized.size,
        normalized.count,
        normalized.promptTemplate,
        normalized.negativePromptTemplate ?? null,
        normalized.referenceImageUrl ?? null,
        JSON.stringify(
          normalized.columnMapping
        ),
        now,
        now
      ]
    );

    return requireTemplate(
      userId,
      id
    );
  }

  async function updateTemplate(
    userId: string,
    templateId: string,
    input: BatchTemplateInput
  ): Promise<BatchTemplateRecord> {
    await initialize();
    await requireTemplate(
      userId,
      templateId
    );

    const normalized =
      normalizeTemplateInput(input);

    const [existing] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT id
         FROM app_batch_templates
         WHERE
           user_id = ?
           AND template_name = ?
           AND id <> ?
         LIMIT 1`,
        [
          userId,
          normalized.name,
          templateId
        ]
      );

    if (existing.length > 0) {
      throw new AuthError(
        409,
        "BATCH_TEMPLATE_EXISTS",
        "同名商品模板已经存在"
      );
    }

    await pool.execute(
      `UPDATE app_batch_templates
       SET
         template_name = ?,
         description = ?,
         provider = ?,
         model = ?,
         size = ?,
         image_count = ?,
         prompt_template = ?,
         negative_prompt_template = ?,
         reference_image_url = ?,
         column_mapping_json = ?,
         updated_at = NOW(3)
       WHERE
         id = ?
         AND user_id = ?`,
      [
        normalized.name,
        normalized.description ?? null,
        normalized.provider,
        normalized.model,
        normalized.size,
        normalized.count,
        normalized.promptTemplate,
        normalized.negativePromptTemplate ?? null,
        normalized.referenceImageUrl ?? null,
        JSON.stringify(
          normalized.columnMapping
        ),
        templateId,
        userId
      ]
    );

    return requireTemplate(
      userId,
      templateId
    );
  }

  async function deleteTemplate(
    userId: string,
    templateId: string
  ): Promise<void> {
    await initialize();

    const [result] =
      await pool.execute<
        ResultSetHeader
      >(
        `DELETE FROM app_batch_templates
         WHERE
           id = ?
           AND user_id = ?`,
        [
          templateId,
          userId
        ]
      );

    if (result.affectedRows < 1) {
      throw new AuthError(
        404,
        "BATCH_TEMPLATE_NOT_FOUND",
        "商品模板不存在"
      );
    }
  }

  async function markTemplateUsed(
    userId: string,
    templateId: string
  ): Promise<BatchTemplateRecord> {
    await initialize();

    const [result] =
      await pool.execute<
        ResultSetHeader
      >(
        `UPDATE app_batch_templates
         SET
           last_used_at = NOW(3),
           updated_at = updated_at
         WHERE
           id = ?
           AND user_id = ?`,
        [
          templateId,
          userId
        ]
      );

    if (result.affectedRows < 1) {
      throw new AuthError(
        404,
        "BATCH_TEMPLATE_NOT_FOUND",
        "商品模板不存在"
      );
    }

    return requireTemplate(
      userId,
      templateId
    );
  }

  async function cloneJob(
    userId: string,
    jobId: string,
    input: CloneBatchInput
  ): Promise<BatchJobRecord> {
    const source =
      await requireJobAccess(
        userId,
        jobId,
        false
      );

    const [itemRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_items
         WHERE batch_id = ?
         ORDER BY position_index ASC`,
        [jobId]
      );

    if (itemRows.length < 1) {
      throw new AuthError(
        400,
        "BATCH_CLONE_EMPTY",
        "原批次没有可复制的商品任务"
      );
    }

    const requestedName =
      normalizeText(
        input.name,
        120
      );

    const sourceName =
      normalizeText(
        source.batch_name,
        120
      ) ||
      "批次";

    const cloned =
      await createJob(
        userId,
        {
          name:
            requestedName ||
            `${sourceName}-副本`,
          rows:
            itemRows.map(
              (row) => ({
                productName:
                  row.product_name,
                prompt:
                  row.prompt,
                negativePrompt:
                  row.negative_prompt,
                provider:
                  row.provider,
                model:
                  row.model,
                size:
                  row.size,
                count:
                  row.image_count,
                referenceImageUrl:
                  row.reference_image_url
              })
            )
        }
      );

    return input.start === true
      ? startJob(
          userId,
          cloned.id
        )
      : cloned;
  }

  async function startJob(
    requesterUserId: string,
    jobId: string,
    allUsers = false
  ): Promise<BatchJobRecord> {
    await requireJobAccess(
      requesterUserId,
      jobId,
      allUsers
    );

    await pool.execute(
      `UPDATE app_batch_jobs
       SET
         status = 'queued',
         updated_at = NOW(3),
         started_at = COALESCE(started_at, NOW(3)),
         completed_at = NULL,
         last_error = NULL
       WHERE
         id = ?
         AND status IN ('draft','paused')`,
      [jobId]
    );

    return readJob(
      requesterUserId,
      jobId,
      allUsers
    );
  }

  async function pauseJob(
    requesterUserId: string,
    jobId: string,
    allUsers = false
  ): Promise<BatchJobRecord> {
    await requireJobAccess(
      requesterUserId,
      jobId,
      allUsers
    );

    await pool.execute(
      `UPDATE app_batch_jobs
       SET
         status = CASE
           WHEN status = 'running' THEN 'pausing'
           WHEN status = 'queued' THEN 'paused'
           ELSE status
         END,
         updated_at = NOW(3)
       WHERE id = ?`,
      [jobId]
    );

    return readJob(
      requesterUserId,
      jobId,
      allUsers
    );
  }

  async function resumeJob(
    requesterUserId: string,
    jobId: string,
    allUsers = false
  ): Promise<BatchJobRecord> {
    await requireJobAccess(
      requesterUserId,
      jobId,
      allUsers
    );

    await pool.execute(
      `UPDATE app_batch_jobs
       SET
         status = 'queued',
         updated_at = NOW(3),
         completed_at = NULL,
         last_error = NULL
       WHERE
         id = ?
         AND status = 'paused'`,
      [jobId]
    );

    return readJob(
      requesterUserId,
      jobId,
      allUsers
    );
  }

  async function retryFailed(
    requesterUserId: string,
    jobId: string,
    allUsers = false
  ): Promise<BatchJobRecord> {
    await requireJobAccess(
      requesterUserId,
      jobId,
      allUsers
    );

    await withTransaction(
      pool,
      async (connection) => {
        await connection.execute(
          `UPDATE app_batch_items
           SET
             status = 'queued',
             progress = NULL,
             error_message = NULL,
             warning_message = NULL,
             generation_task_id = NULL,
             provider_task_id = NULL,
             history_id = NULL,
             points_cost_cents = 0,
             started_at = NULL,
             completed_at = NULL,
             updated_at = NOW(3)
           WHERE
             batch_id = ?
             AND status = 'failed'`,
          [jobId]
        );

        await connection.execute(
          `UPDATE app_batch_jobs
           SET
             status = 'queued',
             failed_items = 0,
             completed_at = NULL,
             last_error = NULL,
             updated_at = NOW(3)
           WHERE id = ?`,
          [jobId]
        );
      }
    );

    await refreshSummary(jobId);

    return readJob(
      requesterUserId,
      jobId,
      allUsers
    );
  }

  async function cancelJob(
    requesterUserId: string,
    jobId: string,
    allUsers = false
  ): Promise<BatchJobRecord> {
    await requireJobAccess(
      requesterUserId,
      jobId,
      allUsers
    );

    const [result] =
      await pool.execute<
        ResultSetHeader
      >(
        `UPDATE app_batch_jobs
         SET
           status = 'cancelled',
           completed_at = NOW(3),
           updated_at = NOW(3)
         WHERE
           id = ?
           AND status IN ('draft','paused','completed')`,
        [jobId]
      );

    if (result.affectedRows < 1) {
      throw new AuthError(
        409,
        "BATCH_CANCEL_BLOCKED",
        "运行中的批次请先暂停，再执行取消"
      );
    }

    return readJob(
      requesterUserId,
      jobId,
      allUsers
    );
  }

  function startWorker(
    intervalMs = readPositiveEnv(
      "BATCH_WORKER_INTERVAL_MS",
      2_000,
      1_000
    )
  ): () => void {
    if (workerTimer) {
      return () => stopWorker();
    }

    stopped = false;

    const initial = setTimeout(
      () => void tick(),
      1_500
    );

    initial.unref();

    workerTimer = setInterval(
      () => void tick(),
      intervalMs
    );

    workerTimer.unref();

    return () => {
      clearTimeout(initial);
      stopWorker();
    };
  }

  function stopWorker() {
    stopped = true;

    if (workerTimer) {
      clearInterval(workerTimer);
      workerTimer = undefined;
    }
  }

  async function tick():
    Promise<void> {
    if (
      stopped ||
      workerBusy
    ) {
      return;
    }

    workerBusy = true;

    try {
      await initialize();
      await processNext();
    } catch (error) {
      console.error(
        "Batch worker error",
        error
      );
    } finally {
      workerBusy = false;
    }
  }

  async function processNext():
    Promise<void> {
    const [jobRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_jobs
         WHERE status IN ('queued','running','pausing')
         ORDER BY
           CASE status
             WHEN 'running' THEN 0
             WHEN 'pausing' THEN 1
             ELSE 2
           END,
           updated_at ASC
         LIMIT 1`
      );

    const job = jobRows[0];

    if (!job) return;

    const jobId = String(job.id);
    const userId = String(job.user_id);
    const status = String(job.status);

    const [runningRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_items
         WHERE
           batch_id = ?
           AND status = 'running'
         ORDER BY position_index ASC
         LIMIT 1`,
        [jobId]
      );

    const running =
      runningRows[0];

    if (running) {
      await reconcileRunningItem(
        job,
        running
      );
      await refreshSummary(jobId);
      return;
    }

    if (status === "pausing") {
      await pool.execute(
        `UPDATE app_batch_jobs
         SET status = 'paused', updated_at = NOW(3)
         WHERE id = ?`,
        [jobId]
      );
      return;
    }

    const [queuedRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_items
         WHERE
           batch_id = ?
           AND status = 'queued'
         ORDER BY position_index ASC
         LIMIT 1`,
        [jobId]
      );

    const item = queuedRows[0];

    if (!item) {
      await finishJobIfComplete(jobId);
      return;
    }

    await pool.execute(
      `UPDATE app_batch_jobs
       SET
         status = 'running',
         started_at = COALESCE(started_at, NOW(3)),
         updated_at = NOW(3)
       WHERE id = ?`,
      [jobId]
    );

    await submitItem(
      job,
      item
    );

    await refreshSummary(jobId);
  }

  async function submitItem(
    job: RowDataPacket,
    item: RowDataPacket
  ): Promise<void> {
    const itemId = String(item.id);
    const userId = String(job.user_id);

    await pool.execute(
      `UPDATE app_batch_items
       SET
         status = 'running',
         progress = '正在准备服务端任务',
         error_message = NULL,
         attempts = attempts + 1,
         started_at = COALESCE(started_at, NOW(3)),
         updated_at = NOW(3)
       WHERE id = ?`,
      [itemId]
    );

    try {
      const referenceUrl =
        optionalText(
          item.reference_image_url
        );

      const referenceImage =
        referenceUrl
          ? await loadReferenceImage(
              referenceUrl
            )
          : undefined;

      await updateItemProgress(
        itemId,
        "正在提交生成任务"
      );

      const payload =
        await internalRequest<
          InternalGenerationPayload
        >(
          userId,
          "/api/images/generate",
          {
            method: "POST",
            body: {
              provider:
                String(item.provider),
              model:
                String(item.model),
              operation:
                referenceImage
                  ? "image-edit"
                  : "text-to-image",
              prompt:
                String(item.prompt),
              negativePrompt:
                optionalText(
                  item.negative_prompt
                ),
              images:
                referenceImage
                  ? [referenceImage]
                  : [],
              size:
                String(item.size),
              count:
                Number(
                  item.image_count
                ),
              batchItemId:
                itemId
            }
          }
        );

      const result = payload.result;

      await pool.execute(
        `UPDATE app_batch_items
         SET
           generation_task_id = COALESCE(?, generation_task_id),
           provider_task_id = COALESCE(?, provider_task_id),
           progress = ?,
           updated_at = NOW(3)
         WHERE id = ?`,
        [
          payload.taskRecordId ?? null,
          result.taskId ??
            result.requestId ??
            null,
          limitText(
            result.progress ||
              (result.status === "completed"
                ? "生成完成"
                : "服务商处理中"),
            300
          ) ?? null,
          itemId
        ]
      );

      if (
        result.status === "pending" ||
        result.status === "processing"
      ) {
        return;
      }

      if (
        result.status === "failed"
      ) {
        throw new Error(
          result.error ||
            "生成任务失败"
        );
      }

      await markSuccess(
        job,
        item,
        payload
      );
    } catch (error) {
      if (
        error instanceof InternalApiError &&
        isRetryableStatus(
          error.status
        )
      ) {
        await pool.execute(
          `UPDATE app_batch_items
           SET
             status = 'queued',
             progress = ?,
             error_message = NULL,
             updated_at = NOW(3)
           WHERE id = ?`,
          [
            `服务暂忙，稍后自动重试：${error.message}`.slice(0, 300),
            itemId
          ]
        );
        return;
      }

      await markFailed(
        itemId,
        errorMessage(error)
      );
    }
  }

  async function reconcileRunningItem(
    job: RowDataPacket,
    item: RowDataPacket
  ): Promise<void> {
    const itemId = String(item.id);
    const userId = String(job.user_id);

    const task =
      await findGenerationTask(
        itemId
      );

    if (!task) {
      const updatedAt =
        readDate(
          item.updated_at
        );

      if (
        Date.now() -
          updatedAt.getTime() >
        120_000
      ) {
        const attempts =
          Number(item.attempts || 0);

        if (attempts < 2) {
          await pool.execute(
            `UPDATE app_batch_items
             SET
               status = 'queued',
               progress = '服务重启后重新排队',
               updated_at = NOW(3)
             WHERE id = ?`,
            [itemId]
          );
        } else {
          await markFailed(
            itemId,
            "服务中断且未找到对应生成任务，请在任务中心核对"
          );
        }
      }

      return;
    }

    await pool.execute(
      `UPDATE app_batch_items
       SET
         generation_task_id = ?,
         provider_task_id = COALESCE(?, provider_task_id),
         progress = COALESCE(?, progress),
         updated_at = NOW(3)
       WHERE id = ?`,
      [
        String(task.id),
        task.provider_task_id ?? null,
        task.provider_progress ?? null,
        itemId
      ]
    );

    if (
      task.status === "success"
    ) {
      if (task.history_id) {
        await markSuccessFromTask(
          job,
          item,
          task
        );
      }
      return;
    }

    if (
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      await markFailed(
        itemId,
        task.error_message ||
          "生成任务失败"
      );
      return;
    }

    const providerTaskId =
      task.provider_task_id;

    if (!providerTaskId) {
      return;
    }

    try {
      const payload =
        await internalRequest<
          InternalGenerationPayload
        >(
          userId,
          `/api/images/tasks/${encodeURIComponent(String(item.provider))}/${encodeURIComponent(providerTaskId)}?model=${encodeURIComponent(String(item.model))}`,
          {
            method: "GET"
          }
        );

      if (
        payload.result.status ===
          "completed"
      ) {
        await markSuccess(
          job,
          item,
          payload
        );
      } else if (
        payload.result.status ===
          "failed"
      ) {
        await markFailed(
          itemId,
          payload.result.error ||
            "异步任务失败"
        );
      } else {
        await updateItemProgress(
          itemId,
          payload.result.progress ||
            "服务商处理中"
        );
      }
    } catch (error) {
      if (
        error instanceof InternalApiError &&
        isRetryableStatus(
          error.status
        )
      ) {
        await updateItemProgress(
          itemId,
          `状态暂时无法读取，稍后重试：${error.message}`
        );
        return;
      }

      await markFailed(
        itemId,
        errorMessage(error)
      );
    }
  }

  async function markSuccess(
    job: RowDataPacket,
    item: RowDataPacket,
    payload: InternalGenerationPayload
  ): Promise<void> {
    const itemId = String(item.id);
    let historyId =
      payload.historyRecord?.id;

    let task =
      await findGenerationTask(
        itemId
      );

    historyId =
      historyId ||
      task?.history_id ||
      undefined;

    if (!historyId) {
      await sleep(600);
      task =
        await findGenerationTask(
          itemId
        );
      historyId =
        task?.history_id ||
        undefined;
    }

    const pointsCost =
      typeof payload.pointsCost ===
        "number"
        ? payload.pointsCost
        : centsToPoints(
            task?.actual_points_cents
          );

    await pool.execute(
      `UPDATE app_batch_items
       SET
         status = 'success',
         progress = '生成完成',
         generation_task_id = COALESCE(?, generation_task_id),
         provider_task_id = COALESCE(?, provider_task_id),
         history_id = COALESCE(?, history_id),
         points_cost_cents = ?,
         error_message = NULL,
         completed_at = NOW(3),
         updated_at = NOW(3)
       WHERE id = ?`,
      [
        payload.taskRecordId ??
          task?.id ??
          null,
        payload.result.taskId ??
          payload.result.requestId ??
          task?.provider_task_id ??
          null,
        historyId ?? null,
        pointsToCents(pointsCost),
        itemId
      ]
    );

    if (historyId) {
      await archiveToFolder(
        String(job.user_id),
        historyId,
        optionalText(job.folder_id),
        String(job.batch_name),
        String(item.product_name)
      );
    }
  }

  async function markSuccessFromTask(
    job: RowDataPacket,
    item: RowDataPacket,
    task: GenerationTaskRow
  ): Promise<void> {
    const historyId =
      optionalText(
        task.history_id
      );

    await pool.execute(
      `UPDATE app_batch_items
       SET
         status = 'success',
         progress = '生成完成',
         generation_task_id = ?,
         provider_task_id = COALESCE(?, provider_task_id),
         history_id = COALESCE(?, history_id),
         points_cost_cents = ?,
         error_message = NULL,
         completed_at = NOW(3),
         updated_at = NOW(3)
       WHERE id = ?`,
      [
        String(task.id),
        task.provider_task_id ?? null,
        historyId ?? null,
        Math.max(
          0,
          Number(
            task.actual_points_cents || 0
          )
        ),
        String(item.id)
      ]
    );

    if (historyId) {
      await archiveToFolder(
        String(job.user_id),
        historyId,
        optionalText(job.folder_id),
        String(job.batch_name),
        String(item.product_name)
      );
    }
  }

  async function archiveToFolder(
    userId: string,
    historyId: string,
    folderId: string | undefined,
    batchName: string,
    productName: string
  ): Promise<void> {
    try {
      await library.updateItem(
        userId,
        historyId,
        {
          folderId:
            folderId || null,
          note:
            `批次：${batchName}\n商品：${productName}`
        }
      );
    } catch (error) {
      console.error(
        "Batch result library archive failed",
        historyId,
        error
      );

      await pool.execute(
        `UPDATE app_batch_items
         SET warning_message = ?, updated_at = NOW(3)
         WHERE history_id = ?`,
        [
          `作品已生成，但自动归档失败：${errorMessage(error)}`.slice(0, 800),
          historyId
        ]
      );
    }
  }

  async function markFailed(
    itemId: string,
    message: string
  ): Promise<void> {
    await pool.execute(
      `UPDATE app_batch_items
       SET
         status = 'failed',
         progress = '失败',
         error_message = ?,
         completed_at = NOW(3),
         updated_at = NOW(3)
       WHERE id = ?`,
      [
        message.slice(0, 800),
        itemId
      ]
    );
  }

  async function refreshSummary(
    jobId: string
  ): Promise<void> {
    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           COUNT(*) AS total_items,
           COALESCE(SUM(status = 'success'), 0) AS success_items,
           COALESCE(SUM(status = 'failed'), 0) AS failed_items,
           COALESCE(SUM(points_cost_cents), 0) AS actual_points_cents,
           COALESCE(SUM(status = 'running'), 0) AS running_items,
           COALESCE(SUM(status = 'queued'), 0) AS queued_items
         FROM app_batch_items
         WHERE batch_id = ?`,
        [jobId]
      );

    const row = rows[0];

    if (!row) return;

    const total =
      Number(row.total_items || 0);
    const success =
      Number(row.success_items || 0);
    const failed =
      Number(row.failed_items || 0);
    const running =
      Number(row.running_items || 0);
    const queued =
      Number(row.queued_items || 0);

    const complete =
      total > 0 &&
      success + failed >= total &&
      running === 0 &&
      queued === 0;

    const actualPointsCents =
      Math.max(
        0,
        Number(
          row.actual_points_cents || 0
        )
      );

    if (complete) {
      await pool.execute(
        `UPDATE app_batch_jobs
         SET
           total_items = ?,
           success_items = ?,
           failed_items = ?,
           actual_points_cents = ?,
           status = CASE
             WHEN status IN ('cancelled','paused')
               THEN status
             ELSE 'completed'
           END,
           completed_at = CASE
             WHEN status IN ('cancelled','paused')
               THEN completed_at
             ELSE COALESCE(completed_at, NOW(3))
           END,
           updated_at = NOW(3)
         WHERE id = ?`,
        [
          total,
          success,
          failed,
          actualPointsCents,
          jobId
        ]
      );
      return;
    }

    await pool.execute(
      `UPDATE app_batch_jobs
       SET
         total_items = ?,
         success_items = ?,
         failed_items = ?,
         actual_points_cents = ?,
         updated_at = NOW(3)
       WHERE id = ?`,
      [
        total,
        success,
        failed,
        actualPointsCents,
        jobId
      ]
    );
  }

  async function finishJobIfComplete(
    jobId: string
  ): Promise<void> {
    await refreshSummary(jobId);

    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT status
         FROM app_batch_jobs
         WHERE id = ?
         LIMIT 1`,
        [jobId]
      );

    if (
      rows[0]?.status === "running" ||
      rows[0]?.status === "queued"
    ) {
      await pool.execute(
        `UPDATE app_batch_jobs
         SET
           status = 'completed',
           completed_at = COALESCE(completed_at, NOW(3)),
           updated_at = NOW(3)
         WHERE id = ?`,
        [jobId]
      );
    }
  }

  async function findGenerationTask(
    batchItemId: string
  ): Promise<GenerationTaskRow | undefined> {
    const [rows] =
      await pool.query<
        GenerationTaskRow[]
      >(
        `SELECT
           id,
           status,
           provider_task_id,
           history_id,
           actual_points_cents,
           refunded_points_cents,
           error_message,
           provider_progress,
           updated_at
         FROM app_generation_tasks
         WHERE batch_item_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [batchItemId]
      );

    return rows[0];
  }

  async function internalRequest<T>(
    userId: string,
    path: string,
    options: {
      method: "GET" | "POST";
      body?: unknown;
    }
  ): Promise<T> {
    const {
      token,
      tokenHash,
      expiresAt
    } = createSessionToken(
      2 * 60 * 60
    );

    const now = new Date();

    await pool.execute(
      `INSERT INTO app_sessions
        (token_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [
        tokenHash,
        userId,
        now,
        expiresAt
      ]
    );

    try {
      const headers:
        Record<string, string> = {
          Cookie:
            `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
          "X-Ecom-Batch-Worker":
            workerSecret
        };

      if (options.body !== undefined) {
        headers["Content-Type"] =
          "application/json";
      }

      const response =
        await fetch(
          `${baseUrl}${path}`,
          {
            method:
              options.method,
            headers,
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(
                    options.body
                  ),
            signal:
              AbortSignal.timeout(
                readPositiveEnv(
                  "BATCH_INTERNAL_REQUEST_TIMEOUT_MS",
                  360_000,
                  30_000
                )
              )
          }
        );

      const data =
        await response.json()
          .catch(() => ({})) as
          T & {
            error?: {
              code?: string;
              message?: string;
            };
          };

      if (!response.ok) {
        throw new InternalApiError(
          response.status,
          data.error?.message ||
            `批次内部请求失败（HTTP ${response.status}）`,
          data.error?.code
        );
      }

      return data;
    } finally {
      await pool.execute(
        "DELETE FROM app_sessions WHERE token_hash = ?",
        [tokenHash]
      ).catch(() => undefined);
    }
  }

  async function loadReferenceImage(
    url: string
  ): Promise<{
    name: string;
    mimeType:
      | "image/jpeg"
      | "image/png"
      | "image/webp";
    dataUrl: string;
  }> {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new Error(
        "参考图 URL 格式不正确"
      );
    }

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      throw new Error(
        "参考图只允许 HTTP(S) URL"
      );
    }

    const response =
      await fetchRemoteImage(parsed);

    if (!response.ok) {
      throw new Error(
        `参考图读取失败（HTTP ${response.status}）`
      );
    }

    const contentLength =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      contentLength >
      10 * 1024 * 1024
    ) {
      throw new Error(
        "参考图超过 10MB"
      );
    }

    const mimeType =
      normalizeImageMime(
        response.headers.get(
          "content-type"
        ) || ""
      );

    if (!mimeType) {
      throw new Error(
        "参考图必须为 JPG、PNG 或 WEBP"
      );
    }

    const bytes =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (
      bytes.byteLength >
      10 * 1024 * 1024
    ) {
      throw new Error(
        "参考图超过 10MB"
      );
    }

    return {
      name:
        fileNameFromUrl(
          parsed,
          mimeType
        ),
      mimeType,
      dataUrl:
        `data:${mimeType};base64,${bytes.toString("base64")}`
    };
  }

  async function fetchRemoteImage(
    initialUrl: URL
  ): Promise<Response> {
    let current = initialUrl;

    for (
      let redirectCount = 0;
      redirectCount <= 3;
      redirectCount += 1
    ) {
      await assertSafeRemoteUrl(current);

      const response =
        await fetch(
          current,
          {
            redirect: "manual",
            signal:
              AbortSignal.timeout(
                120_000
              )
          }
        );

      if (
        response.status < 300 ||
        response.status >= 400
      ) {
        return response;
      }

      const location =
        response.headers.get(
          "location"
        );

      if (!location) {
        return response;
      }

      current =
        new URL(
          location,
          current
        );
    }

    throw new Error(
      "参考图重定向次数过多"
    );
  }

  async function assertSafeRemoteUrl(
    url: URL
  ): Promise<void> {
    const hostname =
      url.hostname
        .toLowerCase()
        .replace(/^\[|\]$/g, "");

    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      throw new Error(
        "参考图 URL 不允许访问本机或内网地址"
      );
    }

    const directIp = isIP(hostname);
    const addresses = directIp
      ? [{ address: hostname }]
      : await lookup(
          hostname,
          {
            all: true,
            verbatim: true
          }
        );

    if (
      addresses.length === 0 ||
      addresses.some(
        ({ address }) =>
          isPrivateAddress(address)
      )
    ) {
      throw new Error(
        "参考图 URL 不允许访问本机或内网地址"
      );
    }
  }

  async function ensureFolder(
    userId: string,
    name: string
  ): Promise<string | undefined> {
    const meta =
      await library.meta(userId);

    const existing =
      meta.folders.find(
        (folder) =>
          folder.name === name
      );

    if (existing) {
      return existing.id;
    }

    try {
      return (
        await library.createFolder(
          userId,
          name
        )
      ).id;
    } catch {
      const refreshed =
        await library.meta(userId);

      return refreshed.folders.find(
        (folder) =>
          folder.name === name
      )?.id;
    }
  }

  async function requireJobAccess(
    userId: string,
    jobId: string,
    allUsers: boolean
  ): Promise<RowDataPacket> {
    await initialize();

    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_jobs
         WHERE
           id = ?
           ${allUsers ? "" : "AND user_id = ?"}
         LIMIT 1`,
        allUsers
          ? [jobId]
          : [jobId, userId]
      );

    const row = rows[0];

    if (!row) {
      throw new AuthError(
        404,
        "BATCH_NOT_FOUND",
        "批次不存在"
      );
    }

    return row;
  }

  async function requireTemplate(
    userId: string,
    templateId: string
  ): Promise<BatchTemplateRecord> {
    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT *
         FROM app_batch_templates
         WHERE
           id = ?
           AND user_id = ?
         LIMIT 1`,
        [
          templateId,
          userId
        ]
      );

    const row = rows[0];

    if (!row) {
      throw new AuthError(
        404,
        "BATCH_TEMPLATE_NOT_FOUND",
        "商品模板不存在"
      );
    }

    return mapTemplate(row);
  }

  function normalizeTemplateInput(
    input: BatchTemplateInput
  ) {
    const name =
      normalizeText(
        input.name,
        120
      );

    if (!name) {
      throw new AuthError(
        400,
        "BATCH_TEMPLATE_NAME_REQUIRED",
        "请输入模板名称"
      );
    }

    const provider =
      normalizeProvider(
        input.provider
      );

    const model =
      normalizeText(
        input.model,
        160
      );

    if (!model) {
      throw new AuthError(
        400,
        "BATCH_TEMPLATE_MODEL_REQUIRED",
        "请选择模板模型"
      );
    }

    const runtime =
      modelSettingsService.get(
        provider,
        model
      );

    if (
      !runtime ||
      !runtime.enabled ||
      !runtime.capability.configured
    ) {
      throw new AuthError(
        400,
        "BATCH_TEMPLATE_MODEL_UNAVAILABLE",
        "模板模型不存在、停用或未配置"
      );
    }

    const size =
      normalizeText(
        input.size,
        80
      ) ||
      runtime.capability.sizes[0] ||
      "auto";

    if (
      !runtime.capability.sizes.includes(
        size
      )
    ) {
      throw new AuthError(
        400,
        "BATCH_TEMPLATE_SIZE_INVALID",
        "模板尺寸不受所选模型支持"
      );
    }

    const count =
      boundedInteger(
        input.count,
        1,
        1,
        runtime.capability.maxOutputImages
      );

    const promptTemplate =
      normalizeText(
        input.promptTemplate,
        5000
      );

    if (
      !promptTemplate ||
      promptTemplate.length < 2
    ) {
      throw new AuthError(
        400,
        "BATCH_TEMPLATE_PROMPT_INVALID",
        "模板提示词至少需要 2 个字符"
      );
    }

    const referenceImageUrl =
      normalizeText(
        input.referenceImageUrl,
        2000
      );

    if (
      referenceImageUrl &&
      !runtime.capability.supportsReferenceImages
    ) {
      throw new AuthError(
        400,
        "BATCH_TEMPLATE_REFERENCE_UNSUPPORTED",
        "所选模型不支持模板参考图"
      );
    }

    return {
      name,
      description:
        normalizeText(
          input.description,
          500
        ),
      provider,
      model,
      size,
      count,
      promptTemplate,
      negativePromptTemplate:
        runtime.capability
          .supportsNegativePrompt
          ? normalizeText(
              input.negativePromptTemplate,
              2000
            )
          : undefined,
      referenceImageUrl,
      columnMapping:
        normalizeColumnMapping(
          input.columnMapping
        )
    };
  }

  function normalizeColumnMapping(
    value: unknown
  ): BatchTemplateColumnMapping {
    const source =
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
        ? value as
            Record<string, unknown>
        : {};

    const output:
      BatchTemplateColumnMapping = {};

    for (const key of [
      "productName",
      "prompt",
      "negativePrompt",
      "provider",
      "model",
      "size",
      "count",
      "referenceImageUrl"
    ] as const) {
      const normalized =
        normalizeText(
          source[key],
          120
        );

      if (normalized) {
        output[key] = normalized;
      }
    }

    return output;
  }

  function mapTemplate(
    row: RowDataPacket
  ): BatchTemplateRecord {
    let mapping:
      BatchTemplateColumnMapping = {};

    const rawMapping =
      row.column_mapping_json;

    try {
      mapping =
        normalizeColumnMapping(
          typeof rawMapping === "string"
            ? JSON.parse(rawMapping)
            : rawMapping
        );
    } catch {
      mapping = {};
    }

    return {
      id: String(row.id),
      userId: String(row.user_id),
      name:
        String(
          row.template_name || ""
        ),
      description:
        optionalText(
          row.description
        ),
      provider:
        String(row.provider || ""),
      model:
        String(row.model || ""),
      size:
        String(row.size || "auto"),
      count:
        boundedInteger(
          row.image_count,
          1,
          1,
          4
        ),
      promptTemplate:
        String(
          row.prompt_template || ""
        ),
      negativePromptTemplate:
        optionalText(
          row.negative_prompt_template
        ),
      referenceImageUrl:
        optionalText(
          row.reference_image_url
        ),
      columnMapping:
        mapping,
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
      lastUsedAt:
        mysqlDateToIso(
          row.last_used_at
        )
    };
  }

  function normalizeRow(
    input: BatchItemInput,
    index: number
  ) {
    const productName =
      normalizeText(
        input.productName,
        160
      ) ||
      `商品 ${index + 1}`;

    const prompt =
      normalizeText(
        input.prompt,
        5000
      );

    if (
      !prompt ||
      prompt.length < 2
    ) {
      throw new AuthError(
        400,
        "BATCH_PROMPT_INVALID",
        `第 ${index + 1} 行提示词至少需要 2 个字符`
      );
    }

    const provider =
      normalizeProvider(
        input.provider
      );

    const model =
      normalizeText(
        input.model,
        160
      );

    if (!model) {
      throw new AuthError(
        400,
        "BATCH_MODEL_REQUIRED",
        `第 ${index + 1} 行缺少模型`
      );
    }

    const runtime =
      modelSettingsService.get(
        provider,
        model
      );

    if (
      !runtime ||
      !runtime.enabled ||
      !runtime.capability.configured
    ) {
      throw new AuthError(
        400,
        "BATCH_MODEL_UNAVAILABLE",
        `第 ${index + 1} 行模型不存在、停用或未配置`
      );
    }

    const size =
      normalizeText(
        input.size,
        80
      ) ||
      runtime.capability.sizes[0] ||
      "auto";

    if (
      !runtime.capability.sizes.includes(
        size
      )
    ) {
      throw new AuthError(
        400,
        "BATCH_SIZE_INVALID",
        `第 ${index + 1} 行尺寸不受该模型支持`
      );
    }

    const count =
      boundedInteger(
        input.count,
        1,
        1,
        runtime.capability.maxOutputImages
      );

    const referenceImageUrl =
      normalizeText(
        input.referenceImageUrl,
        2000
      );

    if (
      referenceImageUrl &&
      !runtime.capability.supportsReferenceImages
    ) {
      throw new AuthError(
        400,
        "BATCH_REFERENCE_UNSUPPORTED",
        `第 ${index + 1} 行模型不支持参考图`
      );
    }

    return {
      productName,
      prompt,
      negativePrompt:
        runtime.capability.supportsNegativePrompt
          ? normalizeText(
              input.negativePrompt,
              2000
            )
          : undefined,
      provider,
      model,
      size,
      count,
      referenceImageUrl,
      operation:
        referenceImageUrl
          ? "image-edit" as const
          : "text-to-image" as const,
      unitPoints:
        runtime.points
    };
  }

  async function readImages(
    historyIds: string[]
  ): Promise<Map<string, BatchImage[]>> {
    const output =
      new Map<
        string,
        BatchImage[]
      >();

    if (historyIds.length === 0) {
      return output;
    }

    const placeholders =
      historyIds.map(() => "?")
        .join(",");

    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           history_id,
           image_url,
           width,
           height,
           mime_type
         FROM app_history_images
         WHERE history_id IN (${placeholders})
         ORDER BY history_id, position_index`,
        historyIds
      );

    for (const row of rows) {
      const historyId =
        String(row.history_id);

      const images =
        output.get(historyId) || [];

      images.push({
        url: String(row.image_url),
        width:
          optionalNumber(row.width),
        height:
          optionalNumber(row.height),
        mimeType:
          optionalText(row.mime_type)
      });

      output.set(
        historyId,
        images
      );
    }

    return output;
  }

  function mapJob(
    row: RowDataPacket
  ): BatchJobRecord {
    const total =
      Number(row.total_items || 0);
    const success =
      Number(row.success_items || 0);
    const failed =
      Number(row.failed_items || 0);
    const running =
      Number(row.running_items || 0);
    const queued =
      Number(row.queued_items || 0);

    return {
      id: String(row.id),
      userId: String(row.user_id),
      username:
        String(row.username || ""),
      name: String(row.batch_name),
      folderId:
        optionalText(row.folder_id),
      status:
        normalizeJobStatus(
          row.status
        ),
      totalItems: total,
      successItems: success,
      failedItems: failed,
      runningItems: running,
      queuedItems: queued,
      progress:
        total > 0
          ? Math.round(
              (success + failed) /
                total * 100
            )
          : 0,
      estimatedPoints:
        centsToPoints(
          row.estimated_points_cents
        ),
      actualPoints:
        centsToPoints(
          row.actual_points_cents
        ),
      lastError:
        optionalText(row.last_error),
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
        )
    };
  }

  function mapItem(
    row: RowDataPacket,
    images: BatchImage[]
  ): BatchItemRecord {
    return {
      id: String(row.id),
      position:
        Number(
          row.position_index || 0
        ),
      productName:
        String(row.product_name),
      prompt:
        String(row.prompt),
      negativePrompt:
        optionalText(
          row.negative_prompt
        ),
      provider:
        String(row.provider),
      model:
        String(row.model),
      operation:
        row.operation === "image-edit"
          ? "image-edit"
          : "text-to-image",
      size: String(row.size),
      count:
        Number(
          row.image_count || 1
        ),
      referenceImageUrl:
        optionalText(
          row.reference_image_url
        ),
      status:
        normalizeItemStatus(
          row.status
        ),
      progress:
        optionalText(row.progress),
      error:
        optionalText(
          row.error_message
        ),
      warning:
        optionalText(
          row.warning_message
        ),
      generationTaskId:
        optionalText(
          row.generation_task_id
        ),
      providerTaskId:
        optionalText(
          row.provider_task_id
        ),
      historyId:
        optionalText(row.history_id),
      pointsCost:
        centsToPoints(
          row.points_cost_cents
        ),
      attempts:
        Number(row.attempts || 0),
      images,
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
        )
    };
  }

  async function updateItemProgress(
    itemId: string,
    progress: string
  ): Promise<void> {
    await pool.execute(
      `UPDATE app_batch_items
       SET progress = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        progress.slice(0, 300),
        itemId
      ]
    );
  }

  return {
    workerSecret,
    initialize,
    listJobs,
    readJob,
    createJob,
    listTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    markTemplateUsed,
    cloneJob,
    startJob,
    pauseJob,
    resumeJob,
    retryFailed,
    cancelJob,
    startWorker
  };
}

function isPrivateAddress(
  value: string
): boolean {
  const address =
    value.toLowerCase();

  if (address.includes(":")) {
    if (
      address === "::" ||
      address === "::1" ||
      address.startsWith("fc") ||
      address.startsWith("fd") ||
      address.startsWith("fe8") ||
      address.startsWith("fe9") ||
      address.startsWith("fea") ||
      address.startsWith("feb")
    ) {
      return true;
    }

    const mapped =
      address.match(
        /::ffff:(\d+\.\d+\.\d+\.\d+)$/
      );

    return mapped?.[1]
      ? isPrivateAddress(mapped[1])
      : false;
  }

  const parts =
    address.split(".")
      .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255
    )
  ) {
    return true;
  }

  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;

  return first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (
      first === 100 &&
      second >= 64 &&
      second <= 127
    ) ||
    (
      first === 169 &&
      second === 254
    ) ||
    (
      first === 172 &&
      second >= 16 &&
      second <= 31
    ) ||
    (
      first === 192 &&
      second === 168
    ) ||
    (
      first === 198 &&
      (
        second === 18 ||
        second === 19
      )
    );
}

function normalizeJobStatus(
  value: unknown
): BatchJobStatus {
  return value === "queued" ||
    value === "running" ||
    value === "pausing" ||
    value === "paused" ||
    value === "completed" ||
    value === "cancelled"
    ? value
    : "draft";
}

function normalizeItemStatus(
  value: unknown
): BatchItemStatus {
  return value === "running" ||
    value === "success" ||
    value === "failed"
    ? value
    : "queued";
}

function normalizeProvider(
  value: unknown
): "grsai" | "nanobanana" | "lingke" {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "";

  if (
    normalized === "grsai" ||
    normalized === "gpt"
  ) {
    return "grsai";
  }

  if (
    normalized === "nanobanana" ||
    normalized === "nano banana" ||
    normalized === "nano-banana"
  ) {
    return "nanobanana";
  }

  if (
    normalized === "lingke" ||
    normalized === "百嘉瑞"
  ) {
    return "lingke";
  }

  throw new AuthError(
    400,
    "BATCH_PROVIDER_INVALID",
    "批次服务商不正确"
  );
}

function normalizeImageMime(
  value: string
):
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | undefined {
  const normalized =
    value.toLowerCase();

  if (
    normalized.includes("jpeg") ||
    normalized.includes("jpg")
  ) {
    return "image/jpeg";
  }

  if (normalized.includes("png")) {
    return "image/png";
  }

  if (normalized.includes("webp")) {
    return "image/webp";
  }

  return undefined;
}

function fileNameFromUrl(
  url: URL,
  mimeType: string
): string {
  const raw =
    decodeURIComponent(
      url.pathname.split("/").pop() ||
        "reference"
    );

  const clean = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 180);

  if (/\.(jpe?g|png|webp)$/i.test(clean)) {
    return clean;
  }

  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : "png";

  return `${clean || "reference"}.${extension}`;
}

function normalizeText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  return normalized
    ? normalized.slice(0, maxLength)
    : undefined;
}

function limitText(
  value: unknown,
  maxLength: number
): string | undefined {
  return normalizeText(
    value,
    maxLength
  );
}

function optionalText(
  value: unknown
): string | undefined {
  return typeof value === "string" &&
    value.length > 0
    ? value
    : undefined;
}

function optionalNumber(
  value: unknown
): number | undefined {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : undefined;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const numeric = Number(value);

  return Number.isInteger(numeric)
    ? Math.max(
        minimum,
        Math.min(maximum, numeric)
      )
    : fallback;
}

function pointsToCents(
  value: number | undefined
): number {
  return Math.max(
    0,
    Math.round(
      (
        typeof value === "number" &&
        Number.isFinite(value)
          ? value
          : 0
      ) * 100
    )
  );
}

function centsToPoints(
  value: unknown
): number {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric / 100
    : 0;
}

function readDate(
  value: unknown
): Date {
  if (value instanceof Date) {
    return value;
  }

  const parsed =
    new Date(String(value || ""));

  return Number.isNaN(
    parsed.getTime()
  )
    ? new Date(0)
    : parsed;
}

function errorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : "批次任务失败";
}

function isRetryableStatus(
  status: number
): boolean {
  return status === 0 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504;
}

function readPositiveEnv(
  name: string,
  fallback: number,
  minimum: number
): number {
  const numeric =
    Number(process.env[name]);

  return Number.isFinite(numeric) &&
    numeric >= minimum
    ? Math.trunc(numeric)
    : fallback;
}

function createDefaultBatchName():
  string {
  const now = new Date();

  return `批量商品图-${now
    .toISOString()
    .slice(0, 16)
    .replace(/[-T:]/g, "")}`;
}

function sleep(
  milliseconds: number
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, milliseconds)
  );
}

export type BatchJobService =
  ReturnType<
    typeof createBatchJobService
  >;
