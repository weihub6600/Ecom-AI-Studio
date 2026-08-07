import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { AuthError } from "../auth.js";
import type { AppDatabase } from "../db/database.js";
import { mysqlDateToIso } from "../db/database.js";

export type AnnouncementKind = "info" | "warning" | "success";

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  kind: AnnouncementKind;
  pinned: boolean;
  published: boolean;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listActiveAnnouncements(
  database: AppDatabase
): Promise<AnnouncementRecord[]> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT *
     FROM app_announcements
     WHERE
       published = 1
       AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
       AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
     ORDER BY pinned DESC, updated_at DESC
     LIMIT 5`
  );
  return rows.map(mapAnnouncement);
}

export async function listAdminAnnouncements(
  database: AppDatabase
): Promise<AnnouncementRecord[]> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT *
     FROM app_announcements
     ORDER BY pinned DESC, updated_at DESC
     LIMIT 200`
  );
  return rows.map(mapAnnouncement);
}

export async function createAnnouncement(
  database: AppDatabase,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<AnnouncementRecord> {
  const id = randomUUID();
  const now = new Date();
  const normalized = normalizeAnnouncement(input, false);

  await database.pool.query(
    `INSERT INTO app_announcements
      (id, title, content, kind, pinned, published, starts_at, ends_at,
       created_at, updated_at, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      normalized.title!,
      normalized.content!,
      normalized.kind!,
      normalized.pinned ? 1 : 0,
      normalized.published ? 1 : 0,
      normalized.startsAt ?? null,
      normalized.endsAt ?? null,
      now,
      now,
      actorUserId
    ]
  );

  return requireAnnouncement(database, id);
}

export async function updateAnnouncement(
  database: AppDatabase,
  id: string,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<AnnouncementRecord> {
  await requireAnnouncement(database, id);
  const normalized = normalizeAnnouncement(input, true);
  const fields: string[] = [];
  const values: Array<string | number | Date | null> = [];

  for (const [key, column] of [
    ["title", "title"],
    ["content", "content"],
    ["kind", "kind"],
    ["pinned", "pinned"],
    ["published", "published"],
    ["startsAt", "starts_at"],
    ["endsAt", "ends_at"]
  ] as const) {
    const value = normalized[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    if (key === "pinned" || key === "published") {
      values.push(value === true ? 1 : 0);
      continue;
    }

    if (
      typeof value === "string" ||
      value instanceof Date ||
      value === null
    ) {
      values.push(value);
    }
  }

  if (fields.length === 0) {
    throw new AuthError(400, "ANNOUNCEMENT_NO_CHANGES", "没有需要保存的公告修改");
  }

  fields.push("updated_at = ?", "updated_by_user_id = ?");
  values.push(new Date(), actorUserId, id);

  await database.pool.query(
    `UPDATE app_announcements SET ${fields.join(", ")} WHERE id = ?`,
    values
  );

  return requireAnnouncement(database, id);
}

export async function deleteAnnouncement(
  database: AppDatabase,
  id: string
): Promise<void> {
  const [result] = await database.pool.execute(
    "DELETE FROM app_announcements WHERE id = ?",
    [id]
  );
  const affected = Number((result as { affectedRows?: number }).affectedRows || 0);
  if (affected < 1) {
    throw new AuthError(404, "ANNOUNCEMENT_NOT_FOUND", "公告不存在");
  }
}

async function requireAnnouncement(
  database: AppDatabase,
  id: string
): Promise<AnnouncementRecord> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    "SELECT * FROM app_announcements WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows[0]) {
    throw new AuthError(404, "ANNOUNCEMENT_NOT_FOUND", "公告不存在");
  }
  return mapAnnouncement(rows[0]);
}

function normalizeAnnouncement(
  input: Record<string, unknown>,
  partial: boolean
): {
  title?: string;
  content?: string;
  kind?: AnnouncementKind;
  pinned?: boolean;
  published?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
} {
  const output: {
    title?: string;
    content?: string;
    kind?: AnnouncementKind;
    pinned?: boolean;
    published?: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
  } = {};

  if (!partial || input.title !== undefined) {
    output.title = requiredText(input.title, 80, "公告标题");
  }
  if (!partial || input.content !== undefined) {
    output.content = requiredText(input.content, 1200, "公告内容");
  }
  if (!partial || input.kind !== undefined) {
    const kind = input.kind ?? "info";
    if (kind !== "info" && kind !== "warning" && kind !== "success") {
      throw new AuthError(400, "INVALID_ANNOUNCEMENT_KIND", "公告类型不正确");
    }
    output.kind = kind;
  }
  if (!partial || input.pinned !== undefined) {
    output.pinned = input.pinned === true;
  }
  if (!partial || input.published !== undefined) {
    output.published = input.published === true;
  }
  if (!partial || input.startsAt !== undefined) {
    output.startsAt = optionalDate(input.startsAt, "公告开始时间");
  }
  if (!partial || input.endsAt !== undefined) {
    output.endsAt = optionalDate(input.endsAt, "公告结束时间");
  }

  if (
    output.startsAt instanceof Date &&
    output.endsAt instanceof Date &&
    output.endsAt.getTime() <= output.startsAt.getTime()
  ) {
    throw new AuthError(400, "INVALID_ANNOUNCEMENT_TIME", "公告结束时间必须晚于开始时间");
  }

  return output;
}

function requiredText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthError(400, "INVALID_ANNOUNCEMENT", `请填写${label}`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new AuthError(400, "INVALID_ANNOUNCEMENT", `${label}不能超过 ${max} 个字符`);
  }
  return text;
}

function optionalDate(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new AuthError(400, "INVALID_ANNOUNCEMENT_TIME", `${label}不正确`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AuthError(400, "INVALID_ANNOUNCEMENT_TIME", `${label}不正确`);
  }
  return date;
}

function mapAnnouncement(row: RowDataPacket): AnnouncementRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    kind:
      row.kind === "warning" || row.kind === "success"
        ? row.kind
        : "info",
    pinned: Boolean(row.pinned),
    published: Boolean(row.published),
    startsAt: row.starts_at ? mysqlDateToIso(row.starts_at) : undefined,
    endsAt: row.ends_at ? mysqlDateToIso(row.ends_at) : undefined,
    createdAt: mysqlDateToIso(row.created_at) || new Date().toISOString(),
    updatedAt: mysqlDateToIso(row.updated_at) || new Date().toISOString()
  };
}
