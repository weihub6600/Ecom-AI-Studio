import {
  rm
} from "node:fs/promises";
import path from "node:path";
import type {
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso,
  withTransaction
} from "../db/database.js";

interface HistoryRetentionOptions {
  database: AppDatabase;
  generatedDir: string;
  maxImagesPerUser?: number;
  maxAgeDays?: number;
  cleanupIntervalMs?: number;
}

interface HistoryRetentionRow
  extends RowDataPacket {
  history_id: string;
  owner_user_id: string | null;
  owner_key: string;
  created_at: string | Date;
  deleted_at: string | Date | null;
  file_name: string | null;
}

interface HistoryRecordCandidate {
  id: string;
  userId?: string;
  ownerKey: string;
  createdAt: number;
  deleted: boolean;
  fileNames: string[];
}

interface StorageBenefit {
  imageLimitBonus: number;
  retentionDaysBonus: number;
}

export interface HistoryCleanupResult {
  deletedRecords: number;
  deletedImages: number;
}

const DEFAULT_MAX_IMAGES_PER_USER = 20;
const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

export function createHistoryRetentionService(
  options: HistoryRetentionOptions
) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function run(): Promise<HistoryCleanupResult> {
    if (running) {
      return {
        deletedRecords: 0,
        deletedImages: 0
      };
    }

    running = true;
    try {
      return await enforceHistoryRetention(options);
    } finally {
      running = false;
    }
  }

  async function start(): Promise<void> {
    const initial = await run();
    logCleanup(initial);

    const interval = positiveInteger(
      options.cleanupIntervalMs,
      DEFAULT_CLEANUP_INTERVAL_MS
    );

    timer = setInterval(() => {
      void run()
        .then(logCleanup)
        .catch((error) => {
          console.error(
            "生成历史定时清理失败",
            error
          );
        });
    }, interval);

    timer.unref();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return {
    start,
    stop,
    run
  };
}

export async function enforceHistoryRetention(
  options: HistoryRetentionOptions,
  onlyUserId?: string
): Promise<HistoryCleanupResult> {
  const [settingsRows] =
    await options.database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         enforcement_enabled,
         base_image_limit,
         base_retention_days,
         grace_days
       FROM app_storage_settings
       WHERE id = 1
       LIMIT 1`
    );

  const settings = settingsRows[0];

  // 第六批把后台存储策略作为真正的总开关。
  // 默认数据库配置为关闭，因此部署后不会自动删除旧数据。
  if (
    !settings ||
    !Boolean(settings.enforcement_enabled)
  ) {
    return {
      deletedRecords: 0,
      deletedImages: 0
    };
  }

  const baseMaxImages = positiveInteger(
    Number(settings.base_image_limit),
    positiveInteger(
      options.maxImagesPerUser,
      DEFAULT_MAX_IMAGES_PER_USER
    )
  );

  const baseMaxAgeDays = positiveInteger(
    Number(settings.base_retention_days),
    positiveInteger(
      options.maxAgeDays,
      DEFAULT_MAX_AGE_DAYS
    )
  );

  const graceDays = nonNegativeInteger(
    Number(settings.grace_days),
    0
  );

  const graceCutoff = new Date(
    Date.now() -
      graceDays *
        24 *
        60 *
        60 *
        1000
  );

  const params: string[] = [];

  const where = [
    `NOT EXISTS (
       SELECT 1
       FROM app_gallery_submissions gs
       WHERE
         gs.history_id = h.id
         AND gs.status IN ('pending','approved')
     )`
  ];

  if (onlyUserId) {
    where.push(
      "(h.owner_user_id = ? OR h.client_id = ?)"
    );
    params.push(
      onlyUserId,
      onlyUserId
    );
  }

  const [rows] =
    await options.database.pool.query<
      HistoryRetentionRow[]
    >(
      `SELECT
         h.id AS history_id,
         h.owner_user_id,
         COALESCE(
           h.owner_user_id,
           h.client_id,
           CONCAT('legacy:', h.id)
         ) AS owner_key,
         h.created_at,
         h.deleted_at,
         i.file_name
       FROM app_history_records h
       LEFT JOIN (
         SELECT
           history_id,
           position_index,
           file_name
         FROM app_history_images
         UNION ALL
         SELECT
           history_id,
           position_index + 1000000 AS position_index,
           file_name
         FROM app_history_source_images
       ) i
         ON i.history_id = h.id
       WHERE ${where.join("\n         AND ")}
       ORDER BY
         owner_key ASC,
         h.created_at DESC,
         i.position_index ASC`,
      params
    );

  const records = groupRows(rows);

  const userIds =
    Array.from(
      new Set(
        records
          .map((item) => item.userId)
          .filter(
            (
              value
            ): value is string =>
              Boolean(value)
          )
      )
    );

  const benefits =
    new Map<string, StorageBenefit>();

  if (userIds.length) {
    for (const ids of chunk(userIds, 200)) {
      const placeholders =
        ids
          .map(() => "?")
          .join(",");

      const [benefitRows] =
        await options.database.pool.query<
          RowDataPacket[]
        >(
          `SELECT
             user_id,
             COALESCE(
               SUM(image_limit_bonus),
               0
             ) AS image_bonus,
             COALESCE(
               SUM(retention_days_bonus),
               0
             ) AS retention_bonus
           FROM app_storage_entitlements
           WHERE
             user_id IN (${placeholders})
             AND expires_at > ?
           GROUP BY user_id`,
          [
            ...ids,
            graceCutoff
          ]
        );

      for (const row of benefitRows) {
        benefits.set(
          String(row.user_id),
          {
            imageLimitBonus:
              nonNegativeInteger(
                Number(row.image_bonus),
                0
              ),
            retentionDaysBonus:
              nonNegativeInteger(
                Number(row.retention_bonus),
                0
              )
          }
        );
      }
    }
  }

  const retainedImageCount =
    new Map<string, number>();

  const deleteRecords:
    HistoryRecordCandidate[] = [];

  for (const record of records) {
    const currentCount =
      retainedImageCount.get(
        record.ownerKey
      ) || 0;

    const imageCount =
      record.fileNames.length;

    const benefit =
      record.userId
        ? benefits.get(record.userId)
        : undefined;

    const ownerMaxImages =
      baseMaxImages +
      (benefit?.imageLimitBonus || 0);

    const ownerMaxAgeDays =
      baseMaxAgeDays +
      (benefit?.retentionDaysBonus || 0);

    const cutoff =
      Date.now() -
      ownerMaxAgeDays *
        24 *
        60 *
        60 *
        1000;

    const expired =
      !Number.isFinite(
        record.createdAt
      ) ||
      record.createdAt < cutoff;

    const exceedsCount =
      currentCount + imageCount >
      ownerMaxImages;

    if (
      record.deleted ||
      expired ||
      exceedsCount
    ) {
      deleteRecords.push(record);
      continue;
    }

    retainedImageCount.set(
      record.ownerKey,
      currentCount + imageCount
    );
  }

  if (!deleteRecords.length) {
    return {
      deletedRecords: 0,
      deletedImages: 0
    };
  }

  const recordIds =
    deleteRecords.map(
      (item) => item.id
    );

  for (
    const ids of chunk(
      recordIds,
      200
    )
  ) {
    const placeholders =
      ids
        .map(() => "?")
        .join(",");

    await withTransaction(
      options.database.pool,
      async (connection) => {
        await connection.query(
          `UPDATE app_generation_tasks
           SET history_id = NULL
           WHERE history_id IN (${placeholders})`,
          ids
        );

        await connection.query(
          `DELETE FROM app_history_source_images
           WHERE history_id IN (${placeholders})`,
          ids
        );

        await connection.query(
          `DELETE FROM app_history_records
           WHERE id IN (${placeholders})`,
          ids
        );
      }
    );
  }

  const fileNames =
    [
      ...new Set(
        deleteRecords.flatMap(
          (item) =>
            item.fileNames
        )
      )
    ];

  await Promise.all(
    fileNames.map(
      (fileName) =>
        rm(
          path.join(
            options.generatedDir,
            fileName
          ),
          {
            force: true
          }
        )
          .catch(
            (error) => {
              console.error(
                `删除过期生成图片失败：${fileName}`,
                error
              );
            }
          )
    )
  );

  return {
    deletedRecords:
      deleteRecords.length,
    deletedImages:
      fileNames.length
  };
}

function groupRows(
  rows: HistoryRetentionRow[]
): HistoryRecordCandidate[] {
  const records =
    new Map<
      string,
      HistoryRecordCandidate
    >();

  for (const row of rows) {
    let record =
      records.get(
        row.history_id
      );

    if (!record) {
      const createdAtIso =
        mysqlDateToIso(
          row.created_at
        );

      record = {
        id:
          row.history_id,
        userId:
          row.owner_user_id
            ? String(
                row.owner_user_id
              )
            : undefined,
        ownerKey:
          String(
            row.owner_key
          ),
        createdAt:
          createdAtIso
            ? new Date(
                createdAtIso
              ).getTime()
            : Number.NaN,
        deleted:
          Boolean(
            row.deleted_at
          ),
        fileNames:
          []
      };

      records.set(
        row.history_id,
        record
      );
    }

    if (
      row.file_name &&
      isSafeGeneratedFileName(
        row.file_name
      )
    ) {
      record.fileNames.push(
        row.file_name
      );
    }
  }

  return [
    ...records.values()
  ];
}

function isSafeGeneratedFileName(
  value: string
): boolean {
  return (
    value ===
      path.basename(value) &&
    /^[A-Za-z0-9_\-\u4e00-\u9fff]+\.(?:png|jpe?g|webp|gif)$/iu.test(
      value
    )
  );
}

function positiveInteger(
  value: number | undefined,
  fallback: number
): number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
  )
    ? value
    : fallback;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number
): number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  )
    ? value
    : fallback;
}

function chunk<T>(
  items: T[],
  size: number
): T[][] {
  const result: T[][] = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    result.push(
      items.slice(
        index,
        index + size
      )
    );
  }

  return result;
}

function logCleanup(
  result: HistoryCleanupResult
): void {
  if (
    !result.deletedRecords &&
    !result.deletedImages
  ) {
    return;
  }

  console.log(
    `生成历史清理完成：删除 ${result.deletedRecords} 条记录、${result.deletedImages} 张图片`
  );
}
