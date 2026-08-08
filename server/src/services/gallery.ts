import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { AuthError } from "../auth.js";
import type { AppDatabase } from "../db/database.js";
import { mysqlDateToIso } from "../db/database.js";

export type GalleryStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type GallerySort = "featured" | "newest";

export interface GalleryQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  provider?: string;
  sort?: GallerySort;
  featured?: boolean;
  status?: GalleryStatus | "all";
}

export interface GalleryItem {
  id: string;
  historyId: string;
  imageId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  title: string;
  description?: string;
  creatorName: string;
  username?: string;
  provider: string;
  model: string;
  prompt?: string;
  showPrompt: boolean;
  status: GalleryStatus;
  featured: boolean;
  rejectionReason?: string;
  submittedAt: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface GalleryEligibleWork {
  historyId: string;
  imageId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  provider: string;
  model: string;
  prompt: string;
  createdAt: string;
}

export async function listPublicGallery(database: AppDatabase, query: GalleryQuery = {}) {
  const page = boundedInt(query.page, 1, 1, 100000);
  const pageSize = boundedInt(query.pageSize, 24, 1, 60);
  const where = ["s.status = 'approved'"];
  const values: Array<string | number> = [];

  const provider = optionalText(query.provider, 80);
  if (provider) {
    where.push("h.provider = ?");
    values.push(provider);
  }

  const search = optionalText(query.search, 120);
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    where.push(`(
      s.title LIKE ? ESCAPE '\\\\'
      OR COALESCE(s.description, '') LIKE ? ESCAPE '\\\\'
      OR h.model LIKE ? ESCAPE '\\\\'
      OR h.provider_name LIKE ? ESCAPE '\\\\'
      OR COALESCE(u.nickname, u.username) LIKE ? ESCAPE '\\\\'
    )`);
    values.push(pattern, pattern, pattern, pattern, pattern);
  }

  if (query.featured) where.push("s.featured = 1");

  const whereSql = where.join(" AND ");
  const [countRows] = await database.pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT s.user_id) AS creators,
            SUM(CASE WHEN s.featured = 1 THEN 1 ELSE 0 END) AS featured
     FROM app_gallery_submissions s
     INNER JOIN app_users u ON u.id = s.user_id
     INNER JOIN app_history_records h ON h.id = s.history_id
     INNER JOIN app_history_images i ON i.id = s.image_id
     WHERE ${whereSql}`,
    values
  );

  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const orderSql = query.sort === "newest"
    ? "s.reviewed_at DESC, s.submitted_at DESC"
    : "s.featured DESC, s.reviewed_at DESC, s.submitted_at DESC";

  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT s.*, u.username, u.nickname,
            h.provider, h.provider_name, h.model, h.prompt,
            h.created_at AS history_created_at,
            i.image_url, i.width, i.height
     FROM app_gallery_submissions s
     INNER JOIN app_users u ON u.id = s.user_id
     INNER JOIN app_history_records h ON h.id = s.history_id
     INNER JOIN app_history_images i ON i.id = s.image_id
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  const [providerRows] = await database.pool.query<RowDataPacket[]>(
    `SELECT DISTINCT h.provider
     FROM app_gallery_submissions s
     INNER JOIN app_history_records h ON h.id = s.history_id
     WHERE s.status = 'approved'
     ORDER BY h.provider ASC
     LIMIT 50`
  );

  return {
    items: rows.map((row) => mapGalleryRow(row, false)),
    pagination: { page: safePage, pageSize, total, totalPages },
    summary: {
      total,
      creators: Number(countRows[0]?.creators || 0),
      featured: Number(countRows[0]?.featured || 0),
      providers: providerRows.map((row) => String(row.provider || "")).filter(Boolean)
    }
  };
}

export async function listGalleryEligibleWorks(database: AppDatabase, userId: string): Promise<GalleryEligibleWork[]> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT h.id AS history_id, h.provider, h.model, h.prompt, h.created_at,
            i.id AS image_id, i.image_url, i.width, i.height
     FROM app_history_records h
     INNER JOIN app_history_images i ON i.history_id = h.id
     LEFT JOIN app_gallery_submissions s
       ON s.user_id = ? AND s.image_id = i.id AND s.status IN ('pending','approved')
     WHERE h.owner_user_id = ? AND h.deleted_at IS NULL AND s.id IS NULL
     ORDER BY h.created_at DESC, i.position_index ASC
     LIMIT 120`,
    [userId, userId]
  );

  return rows.map((row) => ({
    historyId: String(row.history_id),
    imageId: String(row.image_id),
    imageUrl: String(row.image_url),
    width: positiveNumber(row.width),
    height: positiveNumber(row.height),
    provider: String(row.provider),
    model: String(row.model),
    prompt: String(row.prompt || ""),
    createdAt: mysqlDateToIso(row.created_at) || new Date().toISOString()
  }));
}

export async function listUserGallerySubmissions(database: AppDatabase, userId: string): Promise<GalleryItem[]> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT s.*, u.username, u.nickname,
            h.provider, h.provider_name, h.model, h.prompt,
            h.created_at AS history_created_at,
            i.image_url, i.width, i.height
     FROM app_gallery_submissions s
     INNER JOIN app_users u ON u.id = s.user_id
     INNER JOIN app_history_records h ON h.id = s.history_id
     INNER JOIN app_history_images i ON i.id = s.image_id
     WHERE s.user_id = ?
     ORDER BY s.submitted_at DESC
     LIMIT 200`,
    [userId]
  );
  return rows.map((row) => mapGalleryRow(row, true));
}

export async function submitGalleryWork(
  database: AppDatabase,
  userId: string,
  input: Record<string, unknown>
): Promise<GalleryItem> {
  const historyId = requiredId(input.historyId, "作品记录");
  const imageId = requiredId(input.imageId, "作品图片");
  const title = requiredText(input.title, 80, "作品标题");
  const description = optionalText(input.description, 500) || null;
  const showPrompt = input.showPrompt === true;

  const [workRows] = await database.pool.query<RowDataPacket[]>(
    `SELECT h.id AS history_id, i.id AS image_id
     FROM app_history_records h
     INNER JOIN app_history_images i ON i.history_id = h.id
     WHERE h.id = ? AND i.id = ? AND h.owner_user_id = ? AND h.deleted_at IS NULL
     LIMIT 1`,
    [historyId, imageId, userId]
  );

  if (!workRows[0]) {
    throw new AuthError(404, "GALLERY_WORK_NOT_FOUND", "没有找到可投稿的作品图片");
  }

  const [duplicateRows] = await database.pool.query<RowDataPacket[]>(
    `SELECT id FROM app_gallery_submissions
     WHERE user_id = ? AND image_id = ? AND status IN ('pending','approved')
     LIMIT 1`,
    [userId, imageId]
  );
  if (duplicateRows[0]) {
    throw new AuthError(409, "GALLERY_DUPLICATE_SUBMISSION", "这张作品已经在投稿或展示中");
  }

  const id = randomUUID();
  const now = new Date();
  await database.pool.query(
    `INSERT INTO app_gallery_submissions (
       id, user_id, history_id, image_id, title, description, show_prompt,
       status, featured, rejection_reason, submitted_at, reviewed_at,
       reviewed_by_user_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, NULL, NULL, ?)`,
    [id, userId, historyId, imageId, title, description, showPrompt ? 1 : 0, now, now]
  );

  return requireGallerySubmission(database, id, true);
}

export async function withdrawGallerySubmission(
  database: AppDatabase,
  userId: string,
  submissionId: string
): Promise<"withdrawn" | "deleted"> {
  const [rows] =
    await database.pool.query<RowDataPacket[]>(
      `SELECT status
       FROM app_gallery_submissions
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [submissionId, userId]
    );

  const status =
    rows[0]?.status
      ? String(rows[0].status)
      : "";

  if (!status) {
    throw new AuthError(
      404,
      "GALLERY_SUBMISSION_NOT_FOUND",
      "投稿不存在"
    );
  }

  if (
    status === "pending" ||
    status === "approved"
  ) {
    await database.pool.query(
      `UPDATE app_gallery_submissions
       SET
         status = 'withdrawn',
         featured = 0,
         updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND user_id = ?`,
      [submissionId, userId]
    );

    return "withdrawn";
  }

  if (
    status === "rejected" ||
    status === "withdrawn"
  ) {
    await database.pool.query(
      `DELETE FROM app_gallery_submissions
       WHERE id = ? AND user_id = ?`,
      [submissionId, userId]
    );

    return "deleted";
  }

  throw new AuthError(
    409,
    "GALLERY_SUBMISSION_STATE",
    "当前投稿状态无法删除"
  );
}

export async function listAdminGallerySubmissions(database: AppDatabase, query: GalleryQuery = {}) {
  const page = boundedInt(query.page, 1, 1, 100000);
  const pageSize = boundedInt(query.pageSize, 30, 5, 100);
  const where: string[] = [];
  const values: Array<string | number> = [];

  if (query.status && query.status !== "all" && isGalleryStatus(query.status)) {
    where.push("s.status = ?");
    values.push(query.status);
  }

  const search = optionalText(query.search, 120);
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    where.push(`(
      s.title LIKE ? ESCAPE '\\\\'
      OR COALESCE(s.description, '') LIKE ? ESCAPE '\\\\'
      OR u.username LIKE ? ESCAPE '\\\\'
      OR COALESCE(u.nickname, '') LIKE ? ESCAPE '\\\\'
      OR h.model LIKE ? ESCAPE '\\\\'
    )`);
    values.push(pattern, pattern, pattern, pattern, pattern);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [countRows] = await database.pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM app_gallery_submissions s
     INNER JOIN app_users u ON u.id = s.user_id
     INNER JOIN app_history_records h ON h.id = s.history_id
     ${whereSql}`,
    values
  );

  const total = Number(countRows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT s.*, u.username, u.nickname,
            h.provider, h.provider_name, h.model, h.prompt,
            h.created_at AS history_created_at,
            i.image_url, i.width, i.height
     FROM app_gallery_submissions s
     INNER JOIN app_users u ON u.id = s.user_id
     INNER JOIN app_history_records h ON h.id = s.history_id
     INNER JOIN app_history_images i ON i.id = s.image_id
     ${whereSql}
     ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END ASC,
              s.featured DESC, s.submitted_at DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  const [summaryRows] = await database.pool.query<RowDataPacket[]>(
    `SELECT SUM(status = 'pending') AS pending,
            SUM(status = 'approved') AS approved,
            SUM(status = 'rejected') AS rejected,
            SUM(status = 'withdrawn') AS withdrawn,
            SUM(status = 'approved' AND featured = 1) AS featured
     FROM app_gallery_submissions`
  );

  return {
    items: rows.map((row) => mapGalleryRow(row, true)),
    pagination: { page: safePage, pageSize, total, totalPages },
    summary: {
      pending: Number(summaryRows[0]?.pending || 0),
      approved: Number(summaryRows[0]?.approved || 0),
      rejected: Number(summaryRows[0]?.rejected || 0),
      withdrawn: Number(summaryRows[0]?.withdrawn || 0),
      featured: Number(summaryRows[0]?.featured || 0)
    }
  };
}

export async function deleteAdminGallerySubmission(
  database: AppDatabase,
  submissionId: string
): Promise<GalleryItem> {
  const current =
    await requireGallerySubmission(
      database,
      submissionId,
      true
    );

  if (
    current.status !== "rejected" &&
    current.status !== "withdrawn"
  ) {
    throw new AuthError(
      409,
      "GALLERY_SUBMISSION_STATE",
      "只有已拒绝或已撤回的投稿才能删除"
    );
  }

  const [result] =
    await database.pool.query(
      `DELETE FROM app_gallery_submissions
       WHERE
         id = ?
         AND status IN ('rejected', 'withdrawn')`,
      [submissionId]
    );

  const affected =
    Number(
      (
        result as {
          affectedRows?: number;
        }
      ).affectedRows || 0
    );

  if (affected < 1) {
    throw new AuthError(
      404,
      "GALLERY_SUBMISSION_NOT_FOUND",
      "投稿不存在或状态已经变化"
    );
  }

  return current;
}

export async function reviewGallerySubmission(
  database: AppDatabase,
  submissionId: string,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<GalleryItem> {
  const current = await requireGallerySubmission(database, submissionId, true);
  const fields: string[] = [];
  const values: Array<string | number | Date | null> = [];

  if (input.status !== undefined) {
    if (input.status !== "approved" && input.status !== "rejected") {
      throw new AuthError(400, "INVALID_GALLERY_STATUS", "审核状态只能是通过或拒绝");
    }
    fields.push("status = ?", "reviewed_at = ?", "reviewed_by_user_id = ?");
    values.push(input.status, new Date(), actorUserId);

    if (input.status === "rejected") {
      const reason = requiredText(input.rejectionReason, 300, "拒绝原因");
      fields.push("rejection_reason = ?", "featured = 0");
      values.push(reason);
    } else {
      fields.push("rejection_reason = NULL");
    }
  }

  if (input.featured !== undefined) {
    if (current.status !== "approved" && input.status !== "approved") {
      throw new AuthError(400, "GALLERY_NOT_APPROVED", "只有已通过审核的作品才能设为精选");
    }
    fields.push("featured = ?");
    values.push(input.featured === true ? 1 : 0);
  }

  if (!fields.length) {
    throw new AuthError(400, "GALLERY_NO_CHANGES", "没有需要保存的审核修改");
  }

  fields.push("updated_at = ?");
  values.push(new Date(), submissionId);

  await database.pool.query(
    `UPDATE app_gallery_submissions SET ${fields.join(", ")} WHERE id = ?`,
    values
  );

  return requireGallerySubmission(database, submissionId, true);
}

async function requireGallerySubmission(
  database: AppDatabase,
  submissionId: string,
  includePrivate: boolean
): Promise<GalleryItem> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT s.*, u.username, u.nickname,
            h.provider, h.provider_name, h.model, h.prompt,
            h.created_at AS history_created_at,
            i.image_url, i.width, i.height
     FROM app_gallery_submissions s
     INNER JOIN app_users u ON u.id = s.user_id
     INNER JOIN app_history_records h ON h.id = s.history_id
     INNER JOIN app_history_images i ON i.id = s.image_id
     WHERE s.id = ?
     LIMIT 1`,
    [submissionId]
  );
  if (!rows[0]) {
    throw new AuthError(404, "GALLERY_SUBMISSION_NOT_FOUND", "投稿不存在");
  }
  return mapGalleryRow(rows[0], includePrivate);
}

function mapGalleryRow(row: RowDataPacket, includePrivate: boolean): GalleryItem {
  const status = isGalleryStatus(row.status) ? row.status : "pending";
  const showPrompt = Boolean(row.show_prompt);
  return {
    id: String(row.id),
    historyId: String(row.history_id),
    imageId: String(row.image_id),
    imageUrl:
      includePrivate
        ? String(row.image_url)
        : `/api/gallery/${encodeURIComponent(String(row.id))}/image`,
    width: positiveNumber(row.width),
    height: positiveNumber(row.height),
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    creatorName: String(row.nickname || row.username || "ZHE 用户"),
    username: includePrivate && row.username ? String(row.username) : undefined,
    provider: String(row.provider),
    model: String(row.model),
    prompt: showPrompt || includePrivate ? String(row.prompt || "") : undefined,
    showPrompt,
    status,
    featured: Boolean(row.featured),
    rejectionReason: includePrivate && row.rejection_reason ? String(row.rejection_reason) : undefined,
    submittedAt: mysqlDateToIso(row.submitted_at) || new Date().toISOString(),
    reviewedAt: row.reviewed_at ? mysqlDateToIso(row.reviewed_at) : undefined,
    createdAt: mysqlDateToIso(row.history_created_at) || new Date().toISOString()
  };
}

function isGalleryStatus(value: unknown): value is GalleryStatus {
  return value === "pending" || value === "approved" || value === "rejected" || value === "withdrawn";
}

function requiredId(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 80) {
    throw new AuthError(400, "INVALID_GALLERY_REFERENCE", `${label}标识不正确`);
  }
  return text;
}

function requiredText(value: unknown, max: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new AuthError(400, "INVALID_GALLERY_TEXT", `请填写${label}`);
  }
  if (text.length > max || /[\u0000-\u001F\u007F]/u.test(text)) {
    throw new AuthError(400, "INVALID_GALLERY_TEXT", `${label}不能超过 ${max} 个字符且不能包含控制字符`);
  }
  return text;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function escapeLike(value: string): string {
  return value
    .split("\\").join("\\\\")
    .split("%").join("\\%")
    .split("_").join("\\_");
}
