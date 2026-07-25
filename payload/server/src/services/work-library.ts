import {
  randomUUID
} from "node:crypto";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import {
  AuthError
} from "../auth.js";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso,
  withTransaction
} from "../db/database.js";

export type WorkLibrarySort =
  | "newest"
  | "oldest"
  | "updated"
  | "favorite";

export interface WorkLibraryQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  folderId?: string;
  tagId?: string;
  provider?: string;
  favorite?: boolean;
  trash?: boolean;
  sort?: WorkLibrarySort;
}

export interface WorkLibraryImage {
  id: string;
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface WorkLibraryFolder {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkLibraryTag {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
}

export interface WorkLibraryItem {
  id: string;
  generationTaskId?: string;
  provider: string;
  providerName: string;
  model: string;
  prompt: string;
  operation:
    | "text-to-image"
    | "image-edit";
  size: string;
  durationMs?: number;
  cost?: number;
  createdAt: string;
  favorite: boolean;
  note?: string;
  trashedAt?: string;
  folder?: {
    id: string;
    name: string;
  };
  tags: WorkLibraryTag[];
  images: WorkLibraryImage[];
}

export interface WorkLibrarySummary {
  total: number;
  favorite: number;
  trash: number;
  unfiled: number;
}

export interface WorkLibraryListResult {
  items: WorkLibraryItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface WorkLibraryMetaResult {
  folders: WorkLibraryFolder[];
  tags: WorkLibraryTag[];
  summary: WorkLibrarySummary;
}

export interface WorkLibraryItemUpdate {
  favorite?: boolean;
  folderId?: string | null;
  note?: string | null;
  trashed?: boolean;
  tagIds?: string[];
}

export type WorkLibraryBatchAction =
  | "favorite"
  | "unfavorite"
  | "move"
  | "add-tags"
  | "remove-tags"
  | "replace-tags"
  | "trash"
  | "restore";

export interface WorkLibraryBatchInput {
  historyIds: string[];
  action: WorkLibraryBatchAction;
  folderId?: string | null;
  tagIds?: string[];
}

interface HistoryRow extends RowDataPacket {
  id: string;
  generation_task_id: string | null;
  provider: string;
  provider_name: string;
  model: string;
  prompt: string;
  operation: string;
  size: string;
  duration_ms: number | null;
  cost: number | null;
  created_at: Date | string;
  is_favorite: number | null;
  note: string | null;
  trashed_at: Date | string | null;
  folder_id: string | null;
  folder_name: string | null;
  image_id: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  mime_type: string | null;
}

export function createWorkLibraryService(
  database: AppDatabase
) {
  const {
    pool
  } = database;

  let initializePromise:
    Promise<void> |
    undefined;

  function ensureInitialized():
    Promise<void> {
    if (!initializePromise) {
      initializePromise =
        initialize().catch(
          (error) => {
            initializePromise =
              undefined;

            console.error(
              "Work library schema initialization failed",
              error
            );

            throw error;
          }
        );
    }

    return initializePromise;
  }

  async function initialize():
    Promise<void> {
    const libraryCollation =
      await resolveLibraryCollation();

    await repairEmptyIncompatibleLibraryTables(
      libraryCollation
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_library_folders (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        name VARCHAR(80) NOT NULL,
        name_key VARCHAR(80) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_app_library_folder_name (user_id, name_key),
        KEY idx_app_library_folder_user (user_id, updated_at),
        CONSTRAINT fk_app_library_folder_user
          FOREIGN KEY (user_id) REFERENCES app_users(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${libraryCollation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_library_tags (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        name VARCHAR(50) NOT NULL,
        name_key VARCHAR(50) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_app_library_tag_name (user_id, name_key),
        KEY idx_app_library_tag_user (user_id, created_at),
        CONSTRAINT fk_app_library_tag_user
          FOREIGN KEY (user_id) REFERENCES app_users(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${libraryCollation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_library_items (
        history_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        folder_id CHAR(36) NULL,
        is_favorite TINYINT(1) NOT NULL DEFAULT 0,
        note VARCHAR(1000) NULL,
        trashed_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (history_id),
        KEY idx_app_library_item_user (user_id, trashed_at, updated_at),
        KEY idx_app_library_item_folder (folder_id, trashed_at),
        KEY idx_app_library_item_favorite (user_id, is_favorite, trashed_at),
        CONSTRAINT fk_app_library_item_history
          FOREIGN KEY (history_id) REFERENCES app_history_records(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_app_library_item_user
          FOREIGN KEY (user_id) REFERENCES app_users(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_app_library_item_folder
          FOREIGN KEY (folder_id) REFERENCES app_library_folders(id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${libraryCollation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_library_item_tags (
        history_id CHAR(36) NOT NULL,
        tag_id CHAR(36) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (history_id, tag_id),
        KEY idx_app_library_item_tag_tag (tag_id, history_id),
        CONSTRAINT fk_app_library_item_tag_history
          FOREIGN KEY (history_id) REFERENCES app_history_records(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_app_library_item_tag_tag
          FOREIGN KEY (tag_id) REFERENCES app_library_tags(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${libraryCollation}`
    );
  }

  async function resolveLibraryCollation():
    Promise<string> {
    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           TABLE_NAME,
           COLUMN_NAME,
           COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE
           TABLE_SCHEMA = DATABASE()
           AND (
             (
               TABLE_NAME = 'app_users'
               AND COLUMN_NAME = 'id'
             )
             OR (
               TABLE_NAME = 'app_history_records'
               AND COLUMN_NAME = 'id'
             )
           )`
      );

    const collations =
      rows
        .map(
          (row) =>
            typeof row.COLLATION_NAME ===
              "string"
              ? row.COLLATION_NAME
              : ""
        )
        .filter(Boolean);

    const unique =
      Array.from(
        new Set(collations)
      );

    if (
      unique.length !== 1
    ) {
      throw new Error(
        `作品库无法确定统一外键排序规则：${unique.join(", ") || "未读取到核心表排序规则"}`
      );
    }

    const collation =
      unique[0];

    if (
      !collation ||
      !/^[A-Za-z0-9_]+$/.test(
        collation
      )
    ) {
      throw new Error(
        "作品库读取到无效的 MySQL 排序规则"
      );
    }

    return collation;
  }

  async function repairEmptyIncompatibleLibraryTables(
    targetCollation: string
  ): Promise<void> {
    const tableNames = [
      "app_library_folders",
      "app_library_tags",
      "app_library_items",
      "app_library_item_tags"
    ] as const;

    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           TABLE_NAME,
           TABLE_COLLATION
         FROM information_schema.TABLES
         WHERE
           TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN (
             'app_library_folders',
             'app_library_tags',
             'app_library_items',
             'app_library_item_tags'
           )`
      );

    const incompatible =
      rows.filter(
        (row) =>
          typeof row.TABLE_COLLATION ===
            "string" &&
          row.TABLE_COLLATION !==
            targetCollation
      );

    if (
      incompatible.length === 0
    ) {
      return;
    }

    for (
      const tableName of tableNames
    ) {
      const exists =
        rows.some(
          (row) =>
            row.TABLE_NAME ===
            tableName
        );

      if (!exists) continue;

      const [countRows] =
        await pool.query<
          RowDataPacket[]
        >(
          `SELECT COUNT(*) AS total
           FROM ${tableName}`
        );

      if (
        Number(
          countRows[0]?.total || 0
        ) > 0
      ) {
        throw new Error(
          `作品库表 ${tableName} 的排序规则与核心表不一致，且表内已有数据，请先备份后再迁移`
        );
      }
    }

    await pool.query(
      "DROP TABLE IF EXISTS app_library_item_tags"
    );

    await pool.query(
      "DROP TABLE IF EXISTS app_library_items"
    );

    await pool.query(
      "DROP TABLE IF EXISTS app_library_tags"
    );

    await pool.query(
      "DROP TABLE IF EXISTS app_library_folders"
    );
  }

  async function list(
    userId: string,
    query: WorkLibraryQuery = {}
  ): Promise<WorkLibraryListResult> {
    await ensureInitialized();

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
        24,
        1,
        100
      );

    const where = [
      "h.deleted_at IS NULL",
      "(h.owner_user_id = ? OR h.client_id = ?)"
    ];

    const values:
      Array<
        string |
        number |
        Date |
        null
      > = [
        userId,
        userId
      ];

    if (query.trash) {
      where.push(
        "m.trashed_at IS NOT NULL"
      );
    } else {
      where.push(
        "m.trashed_at IS NULL"
      );
    }

    if (query.favorite) {
      where.push(
        "COALESCE(m.is_favorite, 0) = 1"
      );
    }

    const folderId =
      normalizeOptionalId(
        query.folderId
      );

    if (folderId === "unfiled") {
      where.push(
        "m.folder_id IS NULL"
      );
    } else if (folderId) {
      where.push(
        "m.folder_id = ?"
      );

      values.push(folderId);
    }

    const tagId =
      normalizeOptionalId(
        query.tagId
      );

    if (tagId) {
      where.push(
        `EXISTS (
          SELECT 1
          FROM app_library_item_tags fit
          INNER JOIN app_library_tags ft
            ON ft.id = fit.tag_id
          WHERE
            fit.history_id = h.id
            AND fit.tag_id = ?
            AND ft.user_id = ?
        )`
      );

      values.push(
        tagId,
        userId
      );
    }

    const provider =
      normalizeText(
        query.provider,
        80
      );

    if (provider) {
      where.push(
        "h.provider = ?"
      );

      values.push(provider);
    }

    const search =
      normalizeText(
        query.search,
        200
      );

    if (search) {
      const pattern =
        `%${escapeLike(search)}%`;

      where.push(
        `(
          h.prompt LIKE ? ESCAPE '\\\\'
          OR h.model LIKE ? ESCAPE '\\\\'
          OR h.provider_name LIKE ? ESCAPE '\\\\'
          OR COALESCE(m.note, '') LIKE ? ESCAPE '\\\\'
          OR COALESCE(f.name, '') LIKE ? ESCAPE '\\\\'
          OR EXISTS (
            SELECT 1
            FROM app_library_item_tags sit
            INNER JOIN app_library_tags st
              ON st.id = sit.tag_id
            WHERE
              sit.history_id = h.id
              AND st.user_id = ?
              AND st.name LIKE ? ESCAPE '\\\\'
          )
        )`
      );

      values.push(
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        userId,
        pattern
      );
    }

    const whereSql =
      where.join(" AND ");

    const [countRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT COUNT(*) AS total
         FROM app_history_records h
         LEFT JOIN app_library_items m
           ON m.history_id = h.id
           AND m.user_id = ?
         LEFT JOIN app_library_folders f
           ON f.id = m.folder_id
         WHERE ${whereSql}`,
        [
          userId,
          ...values
        ]
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

    const orderSql =
      readOrderSql(
        query.sort
      );

    const [idRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT h.id
         FROM app_history_records h
         LEFT JOIN app_library_items m
           ON m.history_id = h.id
           AND m.user_id = ?
         LEFT JOIN app_library_folders f
           ON f.id = m.folder_id
         WHERE ${whereSql}
         ORDER BY ${orderSql}
         LIMIT ? OFFSET ?`,
        [
          userId,
          ...values,
          pageSize,
          (safePage - 1) * pageSize
        ]
      );

    const ids =
      idRows.map(
        (row) => String(row.id)
      );

    const items =
      ids.length > 0
        ? await readItemsByIds(
            userId,
            ids
          )
        : [];

    return {
      items,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages
      }
    };
  }

  async function meta(
    userId: string
  ): Promise<WorkLibraryMetaResult> {
    await ensureInitialized();

    const [
      folderRows,
      tagRows,
      summaryRows
    ] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `SELECT
           f.id,
           f.name,
           f.created_at,
           f.updated_at,
           COUNT(
             CASE
               WHEN m.trashed_at IS NULL
               THEN m.history_id
             END
           ) AS item_count
         FROM app_library_folders f
         LEFT JOIN app_library_items m
           ON m.folder_id = f.id
           AND m.user_id = f.user_id
         WHERE f.user_id = ?
         GROUP BY
           f.id,
           f.name,
           f.created_at,
           f.updated_at
         ORDER BY
           f.updated_at DESC,
           f.name ASC`,
        [userId]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           t.id,
           t.name,
           t.created_at,
           COUNT(
             CASE
               WHEN m.trashed_at IS NULL
               THEN it.history_id
             END
           ) AS item_count
         FROM app_library_tags t
         LEFT JOIN app_library_item_tags it
           ON it.tag_id = t.id
         LEFT JOIN app_library_items m
           ON m.history_id = it.history_id
           AND m.user_id = t.user_id
         WHERE t.user_id = ?
         GROUP BY
           t.id,
           t.name,
           t.created_at
         ORDER BY
           item_count DESC,
           t.name ASC`,
        [userId]
      ),
      pool.query<RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(m.trashed_at IS NULL), 0) AS total,
           COALESCE(SUM(
             m.trashed_at IS NULL
             AND COALESCE(m.is_favorite, 0) = 1
           ), 0) AS favorite,
           COALESCE(SUM(m.trashed_at IS NOT NULL), 0) AS trash,
           COALESCE(SUM(
             m.trashed_at IS NULL
             AND m.folder_id IS NULL
           ), 0) AS unfiled
         FROM app_history_records h
         LEFT JOIN app_library_items m
           ON m.history_id = h.id
           AND m.user_id = ?
         WHERE
           h.deleted_at IS NULL
           AND (
             h.owner_user_id = ?
             OR h.client_id = ?
           )`,
        [
          userId,
          userId,
          userId
        ]
      )
    ]);

    const summaryRow =
      summaryRows[0][0] ||
      ({} as RowDataPacket);

    return {
      folders:
        folderRows[0].map(
          (row) => ({
            id: String(row.id),
            name: String(row.name),
            itemCount:
              Number(
                row.item_count || 0
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
              new Date().toISOString()
          })
        ),
      tags:
        tagRows[0].map(
          (row) => ({
            id: String(row.id),
            name: String(row.name),
            itemCount:
              Number(
                row.item_count || 0
              ),
            createdAt:
              mysqlDateToIso(
                row.created_at
              ) ||
              new Date().toISOString()
          })
        ),
      summary: {
        total:
          Number(
            summaryRow.total || 0
          ),
        favorite:
          Number(
            summaryRow.favorite || 0
          ),
        trash:
          Number(
            summaryRow.trash || 0
          ),
        unfiled:
          Number(
            summaryRow.unfiled || 0
          )
      }
    };
  }

  async function createFolder(
    userId: string,
    nameInput: unknown
  ): Promise<WorkLibraryFolder> {
    await ensureInitialized();

    const name =
      requiredName(
        nameInput,
        "文件夹名称",
        80
      );

    const existing =
      await findFolderByName(
        userId,
        name
      );

    if (existing) return existing;

    const id = randomUUID();
    const now = new Date();

    try {
      await pool.execute(
        `INSERT INTO app_library_folders
          (id, user_id, name, name_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          name,
          normalizeNameKey(name),
          now,
          now
        ]
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) {
        throw error;
      }

      const raced =
        await findFolderByName(
          userId,
          name
        );

      if (raced) return raced;

      throw error;
    }

    return {
      id,
      name,
      itemCount: 0,
      createdAt:
        now.toISOString(),
      updatedAt:
        now.toISOString()
    };
  }

  async function renameFolder(
    userId: string,
    folderIdInput: unknown,
    nameInput: unknown
  ): Promise<WorkLibraryFolder> {
    await ensureInitialized();

    const folderId =
      requiredId(
        folderIdInput,
        "文件夹 ID"
      );

    const name =
      requiredName(
        nameInput,
        "文件夹名称",
        80
      );

    try {
      const [result] =
        await pool.execute<
          ResultSetHeader
        >(
          `UPDATE app_library_folders
           SET
             name = ?,
             name_key = ?,
             updated_at = ?
           WHERE
             id = ?
             AND user_id = ?`,
          [
            name,
            normalizeNameKey(name),
            new Date(),
            folderId,
            userId
          ]
        );

      if (result.affectedRows === 0) {
        throw new AuthError(
          404,
          "LIBRARY_FOLDER_NOT_FOUND",
          "文件夹不存在"
        );
      }
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new AuthError(
          409,
          "LIBRARY_FOLDER_EXISTS",
          "已经存在同名文件夹"
        );
      }

      throw error;
    }

    const metaResult =
      await meta(userId);

    const folder =
      metaResult.folders.find(
        (item) =>
          item.id === folderId
      );

    if (!folder) {
      throw new AuthError(
        404,
        "LIBRARY_FOLDER_NOT_FOUND",
        "文件夹不存在"
      );
    }

    return folder;
  }

  async function deleteFolder(
    userId: string,
    folderIdInput: unknown
  ): Promise<void> {
    await ensureInitialized();

    const folderId =
      requiredId(
        folderIdInput,
        "文件夹 ID"
      );

    const [result] =
      await pool.execute<
        ResultSetHeader
      >(
        `DELETE FROM app_library_folders
         WHERE
           id = ?
           AND user_id = ?`,
        [
          folderId,
          userId
        ]
      );

    if (result.affectedRows === 0) {
      throw new AuthError(
        404,
        "LIBRARY_FOLDER_NOT_FOUND",
        "文件夹不存在"
      );
    }
  }

  async function createTag(
    userId: string,
    nameInput: unknown
  ): Promise<WorkLibraryTag> {
    await ensureInitialized();

    const name =
      requiredName(
        nameInput,
        "标签名称",
        50
      );

    const existing =
      await findTagByName(
        userId,
        name
      );

    if (existing) return existing;

    const id = randomUUID();
    const now = new Date();

    try {
      await pool.execute(
        `INSERT INTO app_library_tags
          (id, user_id, name, name_key, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          name,
          normalizeNameKey(name),
          now
        ]
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) {
        throw error;
      }

      const raced =
        await findTagByName(
          userId,
          name
        );

      if (raced) return raced;

      throw error;
    }

    return {
      id,
      name,
      itemCount: 0,
      createdAt:
        now.toISOString()
    };
  }

  async function deleteTag(
    userId: string,
    tagIdInput: unknown
  ): Promise<void> {
    await ensureInitialized();

    const tagId =
      requiredId(
        tagIdInput,
        "标签 ID"
      );

    const [result] =
      await pool.execute<
        ResultSetHeader
      >(
        `DELETE FROM app_library_tags
         WHERE
           id = ?
           AND user_id = ?`,
        [
          tagId,
          userId
        ]
      );

    if (result.affectedRows === 0) {
      throw new AuthError(
        404,
        "LIBRARY_TAG_NOT_FOUND",
        "标签不存在"
      );
    }
  }

  async function updateItem(
    userId: string,
    historyIdInput: unknown,
    update: WorkLibraryItemUpdate
  ): Promise<WorkLibraryItem> {
    await ensureInitialized();

    const historyId =
      requiredId(
        historyIdInput,
        "作品 ID"
      );

    await withTransaction(
      pool,
      async (connection) => {
        await requireOwnedHistory(
          connection,
          userId,
          historyId
        );

        await ensureMetadataRow(
          connection,
          userId,
          historyId
        );

        const sets = [
          "updated_at = ?"
        ];

        const values:
          Array<
            string |
            number |
            Date |
            null
          > = [
            new Date()
          ];

        if (
          update.favorite !==
          undefined
        ) {
          sets.push(
            "is_favorite = ?"
          );

          values.push(
            update.favorite
              ? 1
              : 0
          );
        }

        if (
          update.folderId !==
          undefined
        ) {
          const folderId =
            update.folderId === null
              ? null
              : requiredId(
                  update.folderId,
                  "文件夹 ID"
                );

          if (folderId) {
            await requireFolder(
              connection,
              userId,
              folderId
            );
          }

          sets.push(
            "folder_id = ?"
          );

          values.push(folderId);
        }

        if (
          update.note !== undefined
        ) {
          sets.push("note = ?");

          values.push(
            update.note === null
              ? null
              : normalizeText(
                  update.note,
                  1000
                ) ?? null
          );
        }

        if (
          update.trashed !==
          undefined
        ) {
          sets.push(
            "trashed_at = ?"
          );

          values.push(
            update.trashed
              ? new Date()
              : null
          );
        }

        values.push(
          historyId,
          userId
        );

        await connection.execute(
          `UPDATE app_library_items
           SET ${sets.join(", ")}
           WHERE
             history_id = ?
             AND user_id = ?`,
          values
        );

        if (
          update.tagIds !== undefined
        ) {
          const tagIds =
            normalizeIdList(
              update.tagIds,
              50
            );

          await requireTags(
            connection,
            userId,
            tagIds
          );

          await connection.execute(
            `DELETE FROM app_library_item_tags
             WHERE history_id = ?`,
            [historyId]
          );

          for (const tagId of tagIds) {
            await connection.execute(
              `INSERT INTO app_library_item_tags
                (history_id, tag_id, created_at)
               VALUES (?, ?, ?)`,
              [
                historyId,
                tagId,
                new Date()
              ]
            );
          }
        }
      }
    );

    const item =
      await readItemById(
        userId,
        historyId
      );

    if (!item) {
      throw new AuthError(
        404,
        "LIBRARY_ITEM_NOT_FOUND",
        "作品不存在"
      );
    }

    return item;
  }

  async function batch(
    userId: string,
    input: WorkLibraryBatchInput
  ): Promise<number> {
    await ensureInitialized();

    const ids =
      normalizeIdList(
        input.historyIds,
        100
      );

    if (ids.length === 0) {
      throw new AuthError(
        400,
        "LIBRARY_BATCH_EMPTY",
        "请选择至少一个作品"
      );
    }

    const action =
      normalizeBatchAction(
        input.action
      );

    await withTransaction(
      pool,
      async (connection) => {
        await requireOwnedHistories(
          connection,
          userId,
          ids
        );

        for (const historyId of ids) {
          await ensureMetadataRow(
            connection,
            userId,
            historyId
          );
        }

        if (
          action === "favorite" ||
          action === "unfavorite"
        ) {
          const placeholders =
            ids.map(() => "?")
              .join(", ");

          await connection.execute(
            `UPDATE app_library_items
             SET
               is_favorite = ?,
               updated_at = ?
             WHERE
               user_id = ?
               AND history_id IN (${placeholders})`,
            [
              action === "favorite"
                ? 1
                : 0,
              new Date(),
              userId,
              ...ids
            ]
          );
        } else if (
          action === "move"
        ) {
          const folderId =
            input.folderId === null ||
            input.folderId === undefined ||
            input.folderId === ""
              ? null
              : requiredId(
                  input.folderId,
                  "文件夹 ID"
                );

          if (folderId) {
            await requireFolder(
              connection,
              userId,
              folderId
            );
          }

          const placeholders =
            ids.map(() => "?")
              .join(", ");

          await connection.execute(
            `UPDATE app_library_items
             SET
               folder_id = ?,
               updated_at = ?
             WHERE
               user_id = ?
               AND history_id IN (${placeholders})`,
            [
              folderId,
              new Date(),
              userId,
              ...ids
            ]
          );
        } else if (
          action === "trash" ||
          action === "restore"
        ) {
          const placeholders =
            ids.map(() => "?")
              .join(", ");

          await connection.execute(
            `UPDATE app_library_items
             SET
               trashed_at = ?,
               updated_at = ?
             WHERE
               user_id = ?
               AND history_id IN (${placeholders})`,
            [
              action === "trash"
                ? new Date()
                : null,
              new Date(),
              userId,
              ...ids
            ]
          );
        } else {
          const tagIds =
            normalizeIdList(
              input.tagIds || [],
              50
            );

          await requireTags(
            connection,
            userId,
            tagIds
          );

          if (
            action === "replace-tags"
          ) {
            const placeholders =
              ids.map(() => "?")
                .join(", ");

            await connection.execute(
              `DELETE FROM app_library_item_tags
               WHERE history_id IN (${placeholders})`,
              ids
            );
          }

          if (
            action === "remove-tags"
          ) {
            if (tagIds.length > 0) {
              const historyPlaceholders =
                ids.map(() => "?")
                  .join(", ");

              const tagPlaceholders =
                tagIds.map(() => "?")
                  .join(", ");

              await connection.execute(
                `DELETE FROM app_library_item_tags
                 WHERE
                   history_id IN (${historyPlaceholders})
                   AND tag_id IN (${tagPlaceholders})`,
                [
                  ...ids,
                  ...tagIds
                ]
              );
            }
          } else {
            for (const historyId of ids) {
              for (const tagId of tagIds) {
                await connection.execute(
                  `INSERT IGNORE INTO app_library_item_tags
                    (history_id, tag_id, created_at)
                   VALUES (?, ?, ?)`,
                  [
                    historyId,
                    tagId,
                    new Date()
                  ]
                );
              }
            }
          }
        }
      }
    );

    return ids.length;
  }

  async function emptyTrash(
    userId: string
  ): Promise<number> {
    await ensureInitialized();

    return withTransaction(
      pool,
      async (connection) => {
        const [rows] =
          await connection.query<
            RowDataPacket[]
          >(
            `SELECT m.history_id
             FROM app_library_items m
             INNER JOIN app_history_records h
               ON h.id = m.history_id
             WHERE
               m.user_id = ?
               AND m.trashed_at IS NOT NULL
               AND h.deleted_at IS NULL
             FOR UPDATE`,
            [userId]
          );

        const ids =
          rows.map(
            (row) =>
              String(row.history_id)
          );

        if (ids.length === 0) {
          return 0;
        }

        const placeholders =
          ids.map(() => "?")
            .join(", ");

        await connection.execute(
          `UPDATE app_history_records
           SET deleted_at = ?
           WHERE id IN (${placeholders})`,
          [
            new Date(),
            ...ids
          ]
        );

        await connection.execute(
          `DELETE FROM app_library_item_tags
           WHERE history_id IN (${placeholders})`,
          ids
        );

        await connection.execute(
          `DELETE FROM app_library_items
           WHERE history_id IN (${placeholders})`,
          ids
        );

        return ids.length;
      }
    );
  }

  async function readItemById(
    userId: string,
    historyId: string
  ): Promise<WorkLibraryItem | undefined> {
    const items =
      await readItemsByIds(
        userId,
        [historyId]
      );

    return items[0];
  }

  async function readItemsByIds(
    userId: string,
    ids: string[]
  ): Promise<WorkLibraryItem[]> {
    if (ids.length === 0) return [];

    const placeholders =
      ids.map(() => "?")
        .join(", ");

    const [rows] =
      await pool.query<
        HistoryRow[]
      >(
        `SELECT
           h.id,
           h.generation_task_id,
           h.provider,
           h.provider_name,
           h.model,
           h.prompt,
           h.operation,
           h.size,
           h.duration_ms,
           h.cost,
           h.created_at,
           COALESCE(m.is_favorite, 0) AS is_favorite,
           m.note,
           m.trashed_at,
           m.folder_id,
           f.name AS folder_name,
           i.id AS image_id,
           i.image_url,
           i.width AS image_width,
           i.height AS image_height,
           i.mime_type
         FROM app_history_records h
         LEFT JOIN app_library_items m
           ON m.history_id = h.id
           AND m.user_id = ?
         LEFT JOIN app_library_folders f
           ON f.id = m.folder_id
         LEFT JOIN app_history_images i
           ON i.history_id = h.id
         WHERE
           h.deleted_at IS NULL
           AND (
             h.owner_user_id = ?
             OR h.client_id = ?
           )
           AND h.id IN (${placeholders})
         ORDER BY
           FIELD(h.id, ${placeholders}),
           i.position_index ASC`,
        [
          userId,
          userId,
          userId,
          ...ids,
          ...ids
        ]
      );

    const [tagRows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           it.history_id,
           t.id,
           t.name,
           t.created_at
         FROM app_library_item_tags it
         INNER JOIN app_library_tags t
           ON t.id = it.tag_id
         WHERE
           t.user_id = ?
           AND it.history_id IN (${placeholders})
         ORDER BY t.name ASC`,
        [
          userId,
          ...ids
        ]
      );

    const tagsByHistory =
      new Map<
        string,
        WorkLibraryTag[]
      >();

    for (const row of tagRows) {
      const historyId =
        String(row.history_id);

      const tags =
        tagsByHistory.get(historyId) || [];

      tags.push({
        id: String(row.id),
        name: String(row.name),
        itemCount: 0,
        createdAt:
          mysqlDateToIso(
            row.created_at
          ) ||
          new Date().toISOString()
      });

      tagsByHistory.set(
        historyId,
        tags
      );
    }

    const itemMap =
      new Map<
        string,
        WorkLibraryItem
      >();

    for (const row of rows) {
      const id = String(row.id);

      let item =
        itemMap.get(id);

      if (!item) {
        item = {
          id,
          generationTaskId:
            optionalText(
              row.generation_task_id
            ),
          provider:
            String(row.provider),
          providerName:
            String(
              row.provider_name
            ),
          model:
            String(row.model),
          prompt:
            String(row.prompt || ""),
          operation:
            row.operation ===
            "image-edit"
              ? "image-edit"
              : "text-to-image",
          size:
            String(row.size),
          durationMs:
            row.duration_ms === null
              ? undefined
              : Number(
                  row.duration_ms
                ),
          cost:
            row.cost === null
              ? undefined
              : Number(row.cost),
          createdAt:
            mysqlDateToIso(
              row.created_at
            ) ||
            new Date().toISOString(),
          favorite:
            Number(
              row.is_favorite || 0
            ) === 1,
          note:
            optionalText(row.note),
          trashedAt:
            mysqlDateToIso(
              row.trashed_at
            ),
          folder:
            row.folder_id &&
            row.folder_name
              ? {
                  id:
                    String(
                      row.folder_id
                    ),
                  name:
                    String(
                      row.folder_name
                    )
                }
              : undefined,
          tags:
            tagsByHistory.get(id) || [],
          images: []
        };

        itemMap.set(id, item);
      }

      if (
        row.image_id &&
        row.image_url
      ) {
        item.images.push({
          id:
            String(row.image_id),
          url:
            String(row.image_url),
          width:
            row.image_width === null
              ? undefined
              : Number(
                  row.image_width
                ),
          height:
            row.image_height === null
              ? undefined
              : Number(
                  row.image_height
                ),
          mimeType:
            optionalText(
              row.mime_type
            )
        });
      }
    }

    return ids
      .map(
        (id) => itemMap.get(id)
      )
      .filter(
        (
          item
        ): item is WorkLibraryItem =>
          Boolean(item)
      );
  }

  async function findFolderByName(
    userId: string,
    name: string
  ): Promise<WorkLibraryFolder | undefined> {
    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           id,
           name,
           created_at,
           updated_at
         FROM app_library_folders
         WHERE
           user_id = ?
           AND name_key = ?
         LIMIT 1`,
        [
          userId,
          normalizeNameKey(name)
        ]
      );

    const row = rows[0];

    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          itemCount: 0,
          createdAt:
            mysqlDateToIso(
              row.created_at
            ) ||
            new Date().toISOString(),
          updatedAt:
            mysqlDateToIso(
              row.updated_at
            ) ||
            new Date().toISOString()
        }
      : undefined;
  }

  async function findTagByName(
    userId: string,
    name: string
  ): Promise<WorkLibraryTag | undefined> {
    const [rows] =
      await pool.query<
        RowDataPacket[]
      >(
        `SELECT
           id,
           name,
           created_at
         FROM app_library_tags
         WHERE
           user_id = ?
           AND name_key = ?
         LIMIT 1`,
        [
          userId,
          normalizeNameKey(name)
        ]
      );

    const row = rows[0];

    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          itemCount: 0,
          createdAt:
            mysqlDateToIso(
              row.created_at
            ) ||
            new Date().toISOString()
        }
      : undefined;
  }

  return {
    initialize:
      ensureInitialized,
    list,
    meta,
    createFolder,
    renameFolder,
    deleteFolder,
    createTag,
    deleteTag,
    updateItem,
    batch,
    emptyTrash
  };
}

async function requireOwnedHistory(
  connection: PoolConnection,
  userId: string,
  historyId: string
): Promise<void> {
  const [rows] =
    await connection.query<
      RowDataPacket[]
    >(
      `SELECT id
       FROM app_history_records
       WHERE
         id = ?
         AND deleted_at IS NULL
         AND (
           owner_user_id = ?
           OR client_id = ?
         )
       LIMIT 1
       FOR UPDATE`,
      [
        historyId,
        userId,
        userId
      ]
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "LIBRARY_ITEM_NOT_FOUND",
      "作品不存在"
    );
  }
}

async function requireOwnedHistories(
  connection: PoolConnection,
  userId: string,
  historyIds: string[]
): Promise<void> {
  const placeholders =
    historyIds.map(() => "?")
      .join(", ");

  const [rows] =
    await connection.query<
      RowDataPacket[]
    >(
      `SELECT id
       FROM app_history_records
       WHERE
         deleted_at IS NULL
         AND (
           owner_user_id = ?
           OR client_id = ?
         )
         AND id IN (${placeholders})
       FOR UPDATE`,
      [
        userId,
        userId,
        ...historyIds
      ]
    );

  if (rows.length !== historyIds.length) {
    throw new AuthError(
      404,
      "LIBRARY_ITEM_NOT_FOUND",
      "部分作品不存在或不属于当前账号"
    );
  }
}

async function ensureMetadataRow(
  connection: PoolConnection,
  userId: string,
  historyId: string
): Promise<void> {
  const now = new Date();

  await connection.execute(
    `INSERT IGNORE INTO app_library_items
      (history_id, user_id, folder_id, is_favorite, note, trashed_at, created_at, updated_at)
     VALUES (?, ?, NULL, 0, NULL, NULL, ?, ?)`,
    [
      historyId,
      userId,
      now,
      now
    ]
  );
}

async function requireFolder(
  connection: PoolConnection,
  userId: string,
  folderId: string
): Promise<void> {
  const [rows] =
    await connection.query<
      RowDataPacket[]
    >(
      `SELECT id
       FROM app_library_folders
       WHERE
         id = ?
         AND user_id = ?
       LIMIT 1`,
      [
        folderId,
        userId
      ]
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "LIBRARY_FOLDER_NOT_FOUND",
      "文件夹不存在"
    );
  }
}

async function requireTags(
  connection: PoolConnection,
  userId: string,
  tagIds: string[]
): Promise<void> {
  if (tagIds.length === 0) return;

  const placeholders =
    tagIds.map(() => "?")
      .join(", ");

  const [rows] =
    await connection.query<
      RowDataPacket[]
    >(
      `SELECT id
       FROM app_library_tags
       WHERE
         user_id = ?
         AND id IN (${placeholders})`,
      [
        userId,
        ...tagIds
      ]
    );

  if (rows.length !== tagIds.length) {
    throw new AuthError(
      404,
      "LIBRARY_TAG_NOT_FOUND",
      "部分标签不存在"
    );
  }
}

function requiredName(
  value: unknown,
  label: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "LIBRARY_INVALID_NAME",
      `${label}必须是字符串`
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    throw new AuthError(
      400,
      "LIBRARY_INVALID_NAME",
      `${label}不能为空`
    );
  }

  if (
    normalized.length > maxLength
  ) {
    throw new AuthError(
      400,
      "LIBRARY_INVALID_NAME",
      `${label}不能超过 ${maxLength} 个字符`
    );
  }

  return normalized;
}

function requiredId(
  value: unknown,
  label: string
): string {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "LIBRARY_INVALID_ID",
      `${label}不正确`
    );
  }

  const normalized =
    value.trim();

  if (
    !/^[A-Za-z0-9._:-]{8,200}$/.test(
      normalized
    )
  ) {
    throw new AuthError(
      400,
      "LIBRARY_INVALID_ID",
      `${label}不正确`
    );
  }

  return normalized;
}

function normalizeOptionalId(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized =
    value.trim();

  if (!normalized) return undefined;

  if (normalized === "unfiled") {
    return normalized;
  }

  return /^[A-Za-z0-9._:-]{8,200}$/.test(
    normalized
  )
    ? normalized
    : undefined;
}

function normalizeIdList(
  value: unknown,
  maximum: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output =
    new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized =
      item.trim();

    if (
      /^[A-Za-z0-9._:-]{8,200}$/.test(
        normalized
      )
    ) {
      output.add(normalized);
    }

    if (output.size >= maximum) {
      break;
    }
  }

  return [...output];
}

function normalizeBatchAction(
  value: unknown
): WorkLibraryBatchAction {
  if (
    value === "favorite" ||
    value === "unfavorite" ||
    value === "move" ||
    value === "add-tags" ||
    value === "remove-tags" ||
    value === "replace-tags" ||
    value === "trash" ||
    value === "restore"
  ) {
    return value;
  }

  throw new AuthError(
    400,
    "LIBRARY_INVALID_BATCH_ACTION",
    "批量操作不正确"
  );
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

function normalizeNameKey(
  value: string
): string {
  return value
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const numeric = Number(value);

  if (!Number.isInteger(numeric)) {
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

function readOrderSql(
  value: unknown
): string {
  if (value === "oldest") {
    return "h.created_at ASC";
  }

  if (value === "updated") {
    return "COALESCE(m.updated_at, h.created_at) DESC, h.created_at DESC";
  }

  if (value === "favorite") {
    return "COALESCE(m.is_favorite, 0) DESC, h.created_at DESC";
  }

  return "h.created_at DESC";
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

function escapeLike(
  value: string
): string {
  return value.replace(
    /[\\%_]/g,
    (match) => `\\${match}`
  );
}

function isDuplicateEntry(
  error: unknown
): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as {
      code?: unknown
    }).code === "ER_DUP_ENTRY"
  );
}

export type WorkLibraryService =
  ReturnType<
    typeof createWorkLibraryService
  >;
