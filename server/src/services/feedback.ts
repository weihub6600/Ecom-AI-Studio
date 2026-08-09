import { randomUUID } from "node:crypto";
import type {
  RowDataPacket
} from "mysql2/promise";
import {
  AuthError
} from "../auth.js";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso
} from "../db/database.js";

export type FeedbackType =
  | "suggestion"
  | "bug"
  | "question"
  | "other";

export type FeedbackStatus =
  | "open"
  | "processing"
  | "replied"
  | "closed";

export interface FeedbackSummaryRecord {
  id: string;
  userId: string;
  username: string;
  nickname?: string;
  type: FeedbackType;
  title: string;
  content: string;
  status: FeedbackStatus;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  lastRepliedAt?: string;
}

export interface FeedbackReplyRecord {
  id: string;
  feedbackId: string;
  authorUserId?: string;
  authorRole:
    | "user"
    | "admin";
  authorName: string;
  content: string;
  createdAt: string;
}

export interface FeedbackDetailRecord
  extends FeedbackSummaryRecord {
  replies: FeedbackReplyRecord[];
}

export async function listUserFeedback(
  database: AppDatabase,
  userId: string
): Promise<FeedbackSummaryRecord[]> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         f.*,
         u.username,
         u.nickname,
         (
           SELECT COUNT(*)
           FROM app_user_feedback_replies r
           WHERE r.feedback_id = f.id
         ) AS reply_count
       FROM app_user_feedback f
       INNER JOIN app_users u
         ON u.id = f.user_id
       WHERE f.user_id = ?
       ORDER BY f.updated_at DESC`,
      [userId]
    );

  return rows.map(
    mapFeedback
  );
}

export async function createUserFeedback(
  database: AppDatabase,
  userId: string,
  input: Record<string, unknown>
): Promise<FeedbackDetailRecord> {
  const id = randomUUID();
  const now = new Date();

  const type =
    readFeedbackType(
      input.type
    );

  const title =
    requiredText(
      input.title,
      80,
      "请输入反馈标题"
    );

  const content =
    requiredText(
      input.content,
      3000,
      "请输入反馈内容"
    );

  await database.pool.execute(
    `INSERT INTO app_user_feedback
      (
        id,
        user_id,
        type,
        title,
        content,
        status,
        created_at,
        updated_at,
        last_replied_at
      )
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
    [
      id,
      userId,
      type,
      title,
      content,
      now,
      now
    ]
  );

  return getUserFeedbackDetail(
    database,
    userId,
    id
  );
}

export async function getUserFeedbackDetail(
  database: AppDatabase,
  userId: string,
  id: string
): Promise<FeedbackDetailRecord> {
  const feedback =
    await requireFeedback(
      database,
      id,
      userId
    );

  return {
    ...feedback,
    replies:
      await listFeedbackReplies(
        database,
        id
      )
  };
}

export async function addUserFeedbackReply(
  database: AppDatabase,
  userId: string,
  id: string,
  input: Record<string, unknown>
): Promise<FeedbackDetailRecord> {
  const current =
    await requireFeedback(
      database,
      id,
      userId
    );

  if (
    current.status === "closed"
  ) {
    throw new AuthError(
      400,
      "FEEDBACK_CLOSED",
      "该反馈已关闭，无法继续补充"
    );
  }

  const content =
    requiredText(
      input.content,
      3000,
      "请输入补充内容"
    );

  const now = new Date();

  await database.pool.execute(
    `INSERT INTO app_user_feedback_replies
      (
        id,
        feedback_id,
        author_user_id,
        author_role,
        content,
        created_at
      )
     VALUES (?, ?, ?, 'user', ?, ?)`,
    [
      randomUUID(),
      id,
      userId,
      content,
      now
    ]
  );

  await database.pool.execute(
    `UPDATE app_user_feedback
     SET
       status = 'open',
       updated_at = ?
     WHERE id = ?`,
    [
      now,
      id
    ]
  );

  return getUserFeedbackDetail(
    database,
    userId,
    id
  );
}

export async function closeUserFeedback(
  database: AppDatabase,
  userId: string,
  id: string
): Promise<FeedbackDetailRecord> {
  await requireFeedback(
    database,
    id,
    userId
  );

  await database.pool.execute(
    `UPDATE app_user_feedback
     SET
       status = 'closed',
       updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      new Date(),
      id,
      userId
    ]
  );

  return getUserFeedbackDetail(
    database,
    userId,
    id
  );
}

export async function listAdminFeedback(
  database: AppDatabase,
  options: {
    status?: unknown;
    search?: unknown;
    limit?: unknown;
  } = {}
): Promise<FeedbackSummaryRecord[]> {
  const params:
    unknown[] = [];

  const where:
    string[] = [
      "1 = 1"
    ];

  const status =
    readOptionalFeedbackStatus(
      options.status
    );

  if (status) {
    where.push(
      "f.status = ?"
    );
    params.push(status);
  }

  const search =
    optionalText(
      options.search,
      120
    );

  if (search) {
    const pattern =
      `%${search}%`;

    where.push(
      `(
        f.title LIKE ?
        OR f.content LIKE ?
        OR u.username LIKE ?
        OR COALESCE(u.nickname, '') LIKE ?
      )`
    );

    params.push(
      pattern,
      pattern,
      pattern,
      pattern
    );
  }

  const limit =
    readInteger(
      options.limit,
      300,
      1,
      500
    );

  params.push(limit);

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         f.*,
         u.username,
         u.nickname,
         (
           SELECT COUNT(*)
           FROM app_user_feedback_replies r
           WHERE r.feedback_id = f.id
         ) AS reply_count
       FROM app_user_feedback f
       INNER JOIN app_users u
         ON u.id = f.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE f.status
           WHEN 'open' THEN 1
           WHEN 'processing' THEN 2
           WHEN 'replied' THEN 3
           ELSE 4
         END,
         f.updated_at DESC
       LIMIT ?`,
      params
    );

  return rows.map(
    mapFeedback
  );
}

export async function getAdminFeedbackDetail(
  database: AppDatabase,
  id: string
): Promise<FeedbackDetailRecord> {
  const feedback =
    await requireFeedback(
      database,
      id
    );

  return {
    ...feedback,
    replies:
      await listFeedbackReplies(
        database,
        id
      )
  };
}

export async function addAdminFeedbackReply(
  database: AppDatabase,
  actorUserId: string,
  id: string,
  input: Record<string, unknown>
): Promise<FeedbackDetailRecord> {
  await requireFeedback(
    database,
    id
  );

  const content =
    requiredText(
      input.content,
      3000,
      "请输入回复内容"
    );

  const now =
    new Date();

  await database.pool.execute(
    `INSERT INTO app_user_feedback_replies
      (
        id,
        feedback_id,
        author_user_id,
        author_role,
        content,
        created_at
      )
     VALUES (?, ?, ?, 'admin', ?, ?)`,
    [
      randomUUID(),
      id,
      actorUserId,
      content,
      now
    ]
  );

  await database.pool.execute(
    `UPDATE app_user_feedback
     SET
       status = 'replied',
       updated_at = ?,
       last_replied_at = ?
     WHERE id = ?`,
    [
      now,
      now,
      id
    ]
  );

  return getAdminFeedbackDetail(
    database,
    id
  );
}

export async function updateAdminFeedbackStatus(
  database: AppDatabase,
  id: string,
  input: Record<string, unknown>
): Promise<FeedbackDetailRecord> {
  await requireFeedback(
    database,
    id
  );

  const status =
    readFeedbackStatus(
      input.status
    );

  await database.pool.execute(
    `UPDATE app_user_feedback
     SET
       status = ?,
       updated_at = ?
     WHERE id = ?`,
    [
      status,
      new Date(),
      id
    ]
  );

  return getAdminFeedbackDetail(
    database,
    id
  );
}

async function requireFeedback(
  database: AppDatabase,
  id: string,
  userId?: string
): Promise<FeedbackSummaryRecord> {
  const params:
    unknown[] = [id];

  let userFilter = "";

  if (userId) {
    userFilter =
      "AND f.user_id = ?";
    params.push(userId);
  }

  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         f.*,
         u.username,
         u.nickname,
         (
           SELECT COUNT(*)
           FROM app_user_feedback_replies r
           WHERE r.feedback_id = f.id
         ) AS reply_count
       FROM app_user_feedback f
       INNER JOIN app_users u
         ON u.id = f.user_id
       WHERE
         f.id = ?
         ${userFilter}
       LIMIT 1`,
      params
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "FEEDBACK_NOT_FOUND",
      "反馈记录不存在"
    );
  }

  return mapFeedback(
    rows[0]
  );
}

async function listFeedbackReplies(
  database: AppDatabase,
  feedbackId: string
): Promise<FeedbackReplyRecord[]> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT
         r.*,
         u.username,
         u.nickname
       FROM app_user_feedback_replies r
       LEFT JOIN app_users u
         ON u.id = r.author_user_id
       WHERE r.feedback_id = ?
       ORDER BY r.created_at ASC`,
      [feedbackId]
    );

  return rows.map(
    (row) => ({
      id: String(row.id),
      feedbackId:
        String(row.feedback_id),
      authorUserId:
        row.author_user_id
          ? String(
              row.author_user_id
            )
          : undefined,
      authorRole:
        row.author_role ===
          "admin"
          ? "admin"
          : "user",
      authorName:
        String(
          row.nickname ||
          row.username ||
          (
            row.author_role ===
              "admin"
              ? "站长"
              : "用户"
          )
        ),
      content:
        String(
          row.content || ""
        ),
      createdAt:
        requiredMysqlDateToIso(
          row.created_at,
          "反馈回复时间"
        )
    })
  );
}

function mapFeedback(
  row: RowDataPacket
): FeedbackSummaryRecord {
  return {
    id:
      String(row.id),
    userId:
      String(row.user_id),
    username:
      String(
        row.username || ""
      ),
    nickname:
      row.nickname
        ? String(
            row.nickname
          )
        : undefined,
    type:
      readFeedbackType(
        row.type
      ),
    title:
      String(
        row.title || ""
      ),
    content:
      String(
        row.content || ""
      ),
    status:
      readFeedbackStatus(
        row.status
      ),
    replyCount:
      Number(
        row.reply_count || 0
      ),
    createdAt:
      requiredMysqlDateToIso(
        row.created_at,
        "反馈创建时间"
      ),
    updatedAt:
      requiredMysqlDateToIso(
        row.updated_at,
        "反馈更新时间"
      ),
    lastRepliedAt:
      row.last_replied_at
        ? mysqlDateToIso(
            row.last_replied_at
          )
        : undefined
  };
}

function requiredMysqlDateToIso(
  value: unknown,
  fieldName: string
): string {
  const iso =
    mysqlDateToIso(value);

  if (!iso) {
    throw new AuthError(
      500,
      "INVALID_FEEDBACK_DATE",
      fieldName + "格式不正确"
    );
  }

  return iso;
}

function readFeedbackType(
  value: unknown
): FeedbackType {
  return (
    value === "bug" ||
    value === "question" ||
    value === "other"
  )
    ? value
    : "suggestion";
}

function readFeedbackStatus(
  value: unknown
): FeedbackStatus {
  if (
    value === "open" ||
    value === "processing" ||
    value === "replied" ||
    value === "closed"
  ) {
    return value;
  }

  throw new AuthError(
    400,
    "INVALID_FEEDBACK_STATUS",
    "反馈状态不正确"
  );
}

function readOptionalFeedbackStatus(
  value: unknown
): FeedbackStatus | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  return readFeedbackStatus(
    value
  );
}

function requiredText(
  value: unknown,
  maxLength: number,
  message: string
): string {
  const text =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!text) {
    throw new AuthError(
      400,
      "INVALID_FEEDBACK_TEXT",
      message
    );
  }

  return text.slice(
    0,
    maxLength
  );
}

function optionalText(
  value: unknown,
  maxLength: number
): string | undefined {
  const text =
    typeof value === "string"
      ? value.trim()
      : "";

  return text
    ? text.slice(
        0,
        maxLength
      )
    : undefined;
}

function readInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric =
    value === undefined
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(
      numeric
    )
  ) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(
      max,
      numeric
    )
  );
}
