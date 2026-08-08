import { randomUUID } from "node:crypto";
import type {
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import { AuthError } from "../auth.js";
import type { AppDatabase } from "../db/database.js";
import { mysqlDateToIso } from "../db/database.js";

export type SiteMessageKind =
  | "info"
  | "success"
  | "warning";

export type SiteMessageTargetType =
  | "all"
  | "group"
  | "user";

export interface UserGroupRecord {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceUserRecord {
  id: string;
  username: string;
  nickname?: string;
  status:
    | "pending"
    | "active"
    | "disabled"
    | "rejected";
  createdAt: string;
  lastLoginAt?: string;
  groupIds: string[];
}

export interface AdminSiteMessageRecord {
  id: string;
  title: string;
  content: string;
  kind: SiteMessageKind;
  targetType: SiteMessageTargetType;
  targetGroupId?: string;
  targetGroupName?: string;
  targetUserId?: string;
  targetUsername?: string;
  deliveredCount: number;
  readCount: number;
  createdAt: string;
}

export interface UserSiteMessageRecord {
  id: string;
  title: string;
  content: string;
  kind: SiteMessageKind;
  createdAt: string;
  readAt?: string;
  read: boolean;
}

export async function listUserGroups(
  database: AppDatabase
): Promise<UserGroupRecord[]> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         g.id,
         g.name,
         g.description,
         g.sort_order,
         g.created_at,
         g.updated_at,
         (
           SELECT COUNT(*)
           FROM app_user_group_members gm
           WHERE gm.group_id = g.id
         ) AS member_count
       FROM app_user_groups g
       ORDER BY g.sort_order ASC, g.created_at ASC`
    );

  return rows.map(mapGroup);
}

export async function createUserGroup(
  database: AppDatabase,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<UserGroupRecord> {
  const name =
    requiredText(
      input.name,
      60,
      "分组名称"
    );

  const description =
    optionalText(
      input.description,
      300
    );

  await ensureGroupNameAvailable(
    database,
    name
  );

  const id = randomUUID();
  const now = new Date();

  await database.pool.execute(
    `INSERT INTO app_user_groups
      (
        id,
        name,
        description,
        sort_order,
        created_at,
        updated_at,
        updated_by_user_id
      )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      description ?? null,
      readInteger(
        input.sortOrder,
        100,
        0,
        9999
      ),
      now,
      now,
      actorUserId
    ]
  );

  return requireUserGroup(
    database,
    id
  );
}

export async function updateUserGroup(
  database: AppDatabase,
  id: string,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<UserGroupRecord> {
  const current =
    await requireUserGroup(
      database,
      id
    );

  const name =
    input.name === undefined
      ? current.name
      : requiredText(
          input.name,
          60,
          "分组名称"
        );

  if (name !== current.name) {
    await ensureGroupNameAvailable(
      database,
      name,
      id
    );
  }

  const description =
    input.description === undefined
      ? current.description
      : optionalText(
          input.description,
          300
        );

  const sortOrder =
    input.sortOrder === undefined
      ? current.sortOrder
      : readInteger(
          input.sortOrder,
          current.sortOrder,
          0,
          9999
        );

  await database.pool.execute(
    `UPDATE app_user_groups
     SET
       name = ?,
       description = ?,
       sort_order = ?,
       updated_at = ?,
       updated_by_user_id = ?
     WHERE id = ?`,
    [
      name,
      description ?? null,
      sortOrder,
      new Date(),
      actorUserId,
      id
    ]
  );

  return requireUserGroup(
    database,
    id
  );
}

export async function deleteUserGroup(
  database: AppDatabase,
  id: string
): Promise<UserGroupRecord> {
  const current =
    await requireUserGroup(
      database,
      id
    );

  const [result] =
    await database.pool.execute<
      ResultSetHeader
    >(
      `DELETE FROM app_user_groups
       WHERE id = ?`,
      [id]
    );

  if (
    Number(
      result.affectedRows || 0
    ) < 1
  ) {
    throw new AuthError(
      404,
      "USER_GROUP_NOT_FOUND",
      "用户分组不存在"
    );
  }

  return current;
}

export async function listAudienceUsers(
  database: AppDatabase,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  } = {}
): Promise<{
  items: AudienceUserRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}> {
  const page =
    readInteger(
      options.page,
      1,
      1,
      1000000
    );

  const pageSize =
    readInteger(
      options.pageSize,
      30,
      1,
      100
    );

  const where: string[] = [
    "u.role = 'user'"
  ];
  const values:
    Array<string | number> = [];

  const search =
    typeof options.search ===
      "string"
      ? options.search.trim()
      : "";

  if (search) {
    where.push(
      `(u.username LIKE ?
        OR COALESCE(u.nickname, '') LIKE ?)`
    );

    const keyword =
      `%${search.slice(
        0,
        80
      )}%`;

    values.push(
      keyword,
      keyword
    );
  }

  if (
    options.status === "pending" ||
    options.status === "active" ||
    options.status === "disabled" ||
    options.status === "rejected"
  ) {
    where.push(
      "u.status = ?"
    );
    values.push(
      options.status
    );
  }

  const whereSql =
    where.join(" AND ");

  const [countRows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT COUNT(*) AS total
       FROM app_users u
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
        total /
        pageSize
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
         u.id,
         u.username,
         u.nickname,
         u.status,
         u.created_at,
         u.last_login_at,
         (
           SELECT GROUP_CONCAT(
             gm.group_id
             ORDER BY gm.group_id
             SEPARATOR ','
           )
           FROM app_user_group_members gm
           WHERE gm.user_id = u.id
         ) AS group_ids
       FROM app_users u
       WHERE ${whereSql}
       ORDER BY
         u.last_login_at DESC,
         u.created_at DESC
       LIMIT ? OFFSET ?`,
      [
        ...values,
        pageSize,
        offset
      ]
    );

  return {
    items:
      rows.map(
        mapAudienceUser
      ),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages
    }
  };
}

export async function setAudienceUserGroups(
  database: AppDatabase,
  userId: string,
  groupIdsInput: unknown,
  actorUserId: string
): Promise<AudienceUserRecord> {
  const groupIds =
    normalizeStringArray(
      groupIdsInput,
      100
    );

  const [userRows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT id
       FROM app_users
       WHERE
         id = ?
         AND role = 'user'
       LIMIT 1`,
      [userId]
    );

  if (!userRows[0]) {
    throw new AuthError(
      404,
      "AUDIENCE_USER_NOT_FOUND",
      "用户不存在"
    );
  }

  if (
    groupIds.length > 0
  ) {
    const placeholders =
      groupIds
        .map(() => "?")
        .join(",");

    const [groupRows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT id
         FROM app_user_groups
         WHERE id IN (${placeholders})`,
        groupIds
      );

    if (
      groupRows.length !==
      groupIds.length
    ) {
      throw new AuthError(
        400,
        "INVALID_USER_GROUP",
        "选择的用户分组中包含无效分组"
      );
    }
  }

  const connection =
    await database.pool
      .getConnection();

  try {
    await connection
      .beginTransaction();

    await connection.execute(
      `DELETE
       FROM app_user_group_members
       WHERE user_id = ?`,
      [userId]
    );

    for (
      const groupId of
        groupIds
    ) {
      await connection.execute(
        `INSERT INTO app_user_group_members
          (
            group_id,
            user_id,
            added_at,
            added_by_user_id
          )
         VALUES (?, ?, ?, ?)`,
        [
          groupId,
          userId,
          new Date(),
          actorUserId
        ]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         u.id,
         u.username,
         u.nickname,
         u.status,
         u.created_at,
         u.last_login_at,
         (
           SELECT GROUP_CONCAT(
             gm.group_id
             ORDER BY gm.group_id
             SEPARATOR ','
           )
           FROM app_user_group_members gm
           WHERE gm.user_id = u.id
         ) AS group_ids
       FROM app_users u
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );

  return mapAudienceUser(
    rows[0]!
  );
}

export async function listAdminSiteMessages(
  database: AppDatabase,
  options: {
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{
  items: AdminSiteMessageRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}> {
  const page =
    readInteger(
      options.page,
      1,
      1,
      1000000
    );

  const pageSize =
    readInteger(
      options.pageSize,
      20,
      1,
      100
    );

  const [countRows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT COUNT(*) AS total
       FROM app_site_messages`
    );

  const total =
    Number(
      countRows[0]?.total || 0
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total /
        pageSize
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
         m.*,
         g.name AS target_group_name,
         u.username AS target_username,
         (
           SELECT COUNT(*)
           FROM app_site_message_recipients r
           WHERE
             r.message_id = m.id
             AND r.read_at IS NOT NULL
         ) AS read_count
       FROM app_site_messages m
       LEFT JOIN app_user_groups g
         ON g.id = m.target_group_id
       LEFT JOIN app_users u
         ON u.id = m.target_user_id
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [
        pageSize,
        offset
      ]
    );

  return {
    items:
      rows.map(
        mapAdminMessage
      ),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages
    }
  };
}

export async function sendSiteMessage(
  database: AppDatabase,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<AdminSiteMessageRecord> {
  const title =
    requiredText(
      input.title,
      80,
      "消息标题"
    );

  const content =
    requiredText(
      input.content,
      2000,
      "消息内容"
    );

  const kind =
    normalizeMessageKind(
      input.kind
    );

  const targetType =
    normalizeTargetType(
      input.targetType
    );

  let targetGroupId:
    string | null = null;

  let targetUserId:
    string | null = null;

  let recipientRows:
    RowDataPacket[] = [];

  if (
    targetType === "all"
  ) {
    const [rows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT id
         FROM app_users
         WHERE
           role = 'user'
           AND status = 'active'
         ORDER BY created_at ASC`
      );

    recipientRows = rows;
  } else if (
    targetType === "group"
  ) {
    targetGroupId =
      requiredText(
        input.targetGroupId,
        36,
        "目标分组"
      );

    await requireUserGroup(
      database,
      targetGroupId
    );

    const [rows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT u.id
         FROM app_user_group_members gm
         INNER JOIN app_users u
           ON u.id = gm.user_id
         WHERE
           gm.group_id = ?
           AND u.role = 'user'
           AND u.status = 'active'
         ORDER BY u.created_at ASC`,
        [targetGroupId]
      );

    recipientRows = rows;
  } else {
    targetUserId =
      requiredText(
        input.targetUserId,
        36,
        "目标用户"
      );

    const [rows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT id
         FROM app_users
         WHERE
           id = ?
           AND role = 'user'
           AND status = 'active'
         LIMIT 1`,
        [targetUserId]
      );

    recipientRows = rows;
  }

  const recipientIds =
    recipientRows.map(
      (row) =>
        String(row.id)
    );

  if (
    recipientIds.length === 0
  ) {
    throw new AuthError(
      400,
      "MESSAGE_NO_RECIPIENTS",
      "当前目标没有可接收消息的已启用用户"
    );
  }

  const id = randomUUID();
  const now = new Date();

  const connection =
    await database.pool
      .getConnection();

  try {
    await connection
      .beginTransaction();

    await connection.execute(
      `INSERT INTO app_site_messages
        (
          id,
          title,
          content,
          kind,
          target_type,
          target_group_id,
          target_user_id,
          delivered_count,
          created_at,
          created_by_user_id
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        content,
        kind,
        targetType,
        targetGroupId,
        targetUserId,
        recipientIds.length,
        now,
        actorUserId
      ]
    );

    for (
      let index = 0;
      index <
        recipientIds.length;
      index += 500
    ) {
      const chunk =
        recipientIds.slice(
          index,
          index + 500
        );

      const placeholders =
        chunk
          .map(
            () =>
              "(?, ?, NULL, ?)"
          )
          .join(", ");

      const values:
        Array<
          string |
          Date
        > = [];

      for (
        const userId of
          chunk
      ) {
        values.push(
          id,
          userId,
          now
        );
      }

      await connection.execute(
        `INSERT INTO app_site_message_recipients
          (
            message_id,
            user_id,
            read_at,
            created_at
          )
         VALUES ${placeholders}`,
        values
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return requireAdminMessage(
    database,
    id
  );
}

export async function deleteSiteMessage(
  database: AppDatabase,
  id: string
): Promise<AdminSiteMessageRecord> {
  const current =
    await requireAdminMessage(
      database,
      id
    );

  const [result] =
    await database.pool.execute<
      ResultSetHeader
    >(
      `DELETE
       FROM app_site_messages
       WHERE id = ?`,
      [id]
    );

  if (
    Number(
      result.affectedRows || 0
    ) < 1
  ) {
    throw new AuthError(
      404,
      "SITE_MESSAGE_NOT_FOUND",
      "站内消息不存在"
    );
  }

  return current;
}

export async function listUserSiteMessages(
  database: AppDatabase,
  userId: string,
  limitInput: unknown
): Promise<{
  messages: UserSiteMessageRecord[];
  summary: {
    total: number;
    unread: number;
  };
}> {
  const limit =
    readInteger(
      limitInput,
      100,
      1,
      200
    );

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         m.id,
         m.title,
         m.content,
         m.kind,
         m.created_at,
         r.read_at
       FROM app_site_message_recipients r
       INNER JOIN app_site_messages m
         ON m.id = r.message_id
       WHERE r.user_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [
        userId,
        limit
      ]
    );

  const [summaryRows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         COUNT(*) AS total,
         SUM(read_at IS NULL) AS unread
       FROM app_site_message_recipients
       WHERE user_id = ?`,
      [userId]
    );

  return {
    messages:
      rows.map(
        mapUserMessage
      ),
    summary: {
      total:
        Number(
          summaryRows[0]
            ?.total || 0
        ),
      unread:
        Number(
          summaryRows[0]
            ?.unread || 0
        )
    }
  };
}

export async function markUserMessageRead(
  database: AppDatabase,
  userId: string,
  messageId: string
): Promise<UserSiteMessageRecord> {
  const [result] =
    await database.pool.execute<
      ResultSetHeader
    >(
      `UPDATE app_site_message_recipients
       SET read_at =
         COALESCE(
           read_at,
           UTC_TIMESTAMP(3)
         )
       WHERE
         message_id = ?
         AND user_id = ?`,
      [
        messageId,
        userId
      ]
    );

  if (
    Number(
      result.affectedRows || 0
    ) < 1
  ) {
    throw new AuthError(
      404,
      "SITE_MESSAGE_NOT_FOUND",
      "消息不存在"
    );
  }

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         m.id,
         m.title,
         m.content,
         m.kind,
         m.created_at,
         r.read_at
       FROM app_site_message_recipients r
       INNER JOIN app_site_messages m
         ON m.id = r.message_id
       WHERE
         r.message_id = ?
         AND r.user_id = ?
       LIMIT 1`,
      [
        messageId,
        userId
      ]
    );

  return mapUserMessage(
    rows[0]!
  );
}

export async function markAllUserMessagesRead(
  database: AppDatabase,
  userId: string
): Promise<number> {
  const [result] =
    await database.pool.execute<
      ResultSetHeader
    >(
      `UPDATE app_site_message_recipients
       SET read_at =
         UTC_TIMESTAMP(3)
       WHERE
         user_id = ?
         AND read_at IS NULL`,
      [userId]
    );

  return Number(
    result.affectedRows || 0
  );
}

async function requireUserGroup(
  database: AppDatabase,
  id: string
): Promise<UserGroupRecord> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         g.id,
         g.name,
         g.description,
         g.sort_order,
         g.created_at,
         g.updated_at,
         (
           SELECT COUNT(*)
           FROM app_user_group_members gm
           WHERE gm.group_id = g.id
         ) AS member_count
       FROM app_user_groups g
       WHERE g.id = ?
       LIMIT 1`,
      [id]
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "USER_GROUP_NOT_FOUND",
      "用户分组不存在"
    );
  }

  return mapGroup(
    rows[0]
  );
}

async function requireAdminMessage(
  database: AppDatabase,
  id: string
): Promise<AdminSiteMessageRecord> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         m.*,
         g.name AS target_group_name,
         u.username AS target_username,
         (
           SELECT COUNT(*)
           FROM app_site_message_recipients r
           WHERE
             r.message_id = m.id
             AND r.read_at IS NOT NULL
         ) AS read_count
       FROM app_site_messages m
       LEFT JOIN app_user_groups g
         ON g.id = m.target_group_id
       LEFT JOIN app_users u
         ON u.id = m.target_user_id
       WHERE m.id = ?
       LIMIT 1`,
      [id]
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "SITE_MESSAGE_NOT_FOUND",
      "站内消息不存在"
    );
  }

  return mapAdminMessage(
    rows[0]
  );
}

async function ensureGroupNameAvailable(
  database: AppDatabase,
  name: string,
  excludeId?: string
): Promise<void> {
  const values: string[] = [
    name
  ];

  let sql =
    `SELECT id
     FROM app_user_groups
     WHERE name = ?`;

  if (excludeId) {
    sql +=
      " AND id <> ?";
    values.push(
      excludeId
    );
  }

  sql += " LIMIT 1";

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      sql,
      values
    );

  if (rows[0]) {
    throw new AuthError(
      409,
      "USER_GROUP_NAME_EXISTS",
      "已经存在同名用户分组"
    );
  }
}

function mapGroup(
  row: RowDataPacket
): UserGroupRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description:
      row.description
        ? String(
            row.description
          )
        : undefined,
    sortOrder:
      Number(
        row.sort_order || 0
      ),
    memberCount:
      Number(
        row.member_count || 0
      ),
    createdAt:
      mysqlDateToIso(
        row.created_at
      ) ||
      new Date()
        .toISOString(),
    updatedAt:
      mysqlDateToIso(
        row.updated_at
      ) ||
      new Date()
        .toISOString()
  };
}

function mapAudienceUser(
  row: RowDataPacket
): AudienceUserRecord {
  return {
    id: String(row.id),
    username:
      String(row.username),
    nickname:
      row.nickname
        ? String(row.nickname)
        : undefined,
    status:
      normalizeUserStatus(
        row.status
      ),
    createdAt:
      mysqlDateToIso(
        row.created_at
      ) ||
      new Date()
        .toISOString(),
    lastLoginAt:
      row.last_login_at
        ? mysqlDateToIso(
            row.last_login_at
          )
        : undefined,
    groupIds:
      typeof row.group_ids ===
        "string" &&
      row.group_ids
        ? row.group_ids
            .split(",")
            .filter(Boolean)
        : []
  };
}

function mapAdminMessage(
  row: RowDataPacket
): AdminSiteMessageRecord {
  const targetType =
    normalizeTargetType(
      row.target_type
    );

  return {
    id: String(row.id),
    title: String(row.title),
    content:
      String(row.content),
    kind:
      normalizeMessageKind(
        row.kind
      ),
    targetType,
    targetGroupId:
      row.target_group_id
        ? String(
            row.target_group_id
          )
        : undefined,
    targetGroupName:
      row.target_group_name
        ? String(
            row.target_group_name
          )
        : undefined,
    targetUserId:
      row.target_user_id
        ? String(
            row.target_user_id
          )
        : undefined,
    targetUsername:
      row.target_username
        ? String(
            row.target_username
          )
        : undefined,
    deliveredCount:
      Number(
        row.delivered_count || 0
      ),
    readCount:
      Number(
        row.read_count || 0
      ),
    createdAt:
      mysqlDateToIso(
        row.created_at
      ) ||
      new Date()
        .toISOString()
  };
}

function mapUserMessage(
  row: RowDataPacket
): UserSiteMessageRecord {
  const readAt =
    row.read_at
      ? mysqlDateToIso(
          row.read_at
        )
      : undefined;

  return {
    id: String(row.id),
    title: String(row.title),
    content:
      String(row.content),
    kind:
      normalizeMessageKind(
        row.kind
      ),
    createdAt:
      mysqlDateToIso(
        row.created_at
      ) ||
      new Date()
        .toISOString(),
    readAt,
    read: Boolean(readAt)
  };
}

function normalizeMessageKind(
  value: unknown
): SiteMessageKind {
  if (
    value === "success" ||
    value === "warning"
  ) {
    return value;
  }

  return "info";
}

function normalizeTargetType(
  value: unknown
): SiteMessageTargetType {
  if (
    value === "group" ||
    value === "user"
  ) {
    return value;
  }

  return "all";
}

function normalizeUserStatus(
  value: unknown
):
  | "pending"
  | "active"
  | "disabled"
  | "rejected" {
  if (
    value === "pending" ||
    value === "disabled" ||
    value === "rejected"
  ) {
    return value;
  }

  return "active";
}

function requiredText(
  value: unknown,
  max: number,
  label: string
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new AuthError(
      400,
      "INVALID_AUDIENCE_INPUT",
      `请填写${label}`
    );
  }

  const text =
    value.trim();

  if (
    text.length > max
  ) {
    throw new AuthError(
      400,
      "INVALID_AUDIENCE_INPUT",
      `${label}不能超过 ${max} 个字符`
    );
  }

  return text;
}

function optionalText(
  value: unknown,
  max: number
): string | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  if (
    typeof value !== "string"
  ) {
    throw new AuthError(
      400,
      "INVALID_AUDIENCE_INPUT",
      "文本内容不正确"
    );
  }

  const text =
    value.trim();

  if (
    text.length > max
  ) {
    throw new AuthError(
      400,
      "INVALID_AUDIENCE_INPUT",
      `文本不能超过 ${max} 个字符`
    );
  }

  return text || undefined;
}

function readInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim()
        ? Number(value)
        : fallback;

  if (
    !Number.isFinite(parsed)
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.trunc(parsed)
    )
  );
}

function normalizeStringArray(
  value: unknown,
  maxItems: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(
          (item):
            item is string =>
            typeof item ===
              "string"
        )
        .map(
          (item) =>
            item.trim()
        )
        .filter(Boolean)
        .slice(
          0,
          maxItems
        )
    )
  ];
}
