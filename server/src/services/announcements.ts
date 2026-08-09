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

export type AnnouncementKind =
  | "info"
  | "warning"
  | "success";

export type AnnouncementDisplayMode =
  | "topbar"
  | "popup";

export type AnnouncementMotion =
  | "none"
  | "shimmer"
  | "pulse"
  | "gradient";

export type AnnouncementIcon =
  | "megaphone"
  | "gift"
  | "sparkles"
  | "bell"
  | "info"
  | "warning"
  | "rocket"
  | "clock";

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  kind: AnnouncementKind;
  displayMode:
    AnnouncementDisplayMode;
  icon: AnnouncementIcon;
  motion: AnnouncementMotion;
  linkUrl?: string;
  linkText?: string;
  countdownEnabled: boolean;
  pinned: boolean;
  published: boolean;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export async function ensureAnnouncementExperienceSchema(
  database: AppDatabase
): Promise<void> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE
         TABLE_SCHEMA = ?
         AND TABLE_NAME = 'app_announcements'`,
      [database.databaseName]
    );

  const existing =
    new Set(
      rows.map(
        (row) =>
          String(
            row.COLUMN_NAME ||
            row.column_name ||
            ""
          )
      )
    );

  const additions:
    Array<{
      name: string;
      sql: string;
    }> = [
      {
        name:
          "display_mode",
        sql:
          `ALTER TABLE app_announcements
           ADD COLUMN display_mode ENUM('topbar','popup')
           NOT NULL DEFAULT 'topbar'
           AFTER kind`
      },
      {
        name:
          "icon",
        sql:
          `ALTER TABLE app_announcements
           ADD COLUMN icon VARCHAR(40)
           NOT NULL DEFAULT 'megaphone'
           AFTER display_mode`
      },
      {
        name:
          "motion",
        sql:
          `ALTER TABLE app_announcements
           ADD COLUMN motion ENUM('none','shimmer','pulse','gradient')
           NOT NULL DEFAULT 'none'
           AFTER icon`
      },
      {
        name:
          "link_url",
        sql:
          `ALTER TABLE app_announcements
           ADD COLUMN link_url VARCHAR(800)
           NULL
           AFTER motion`
      },
      {
        name:
          "link_text",
        sql:
          `ALTER TABLE app_announcements
           ADD COLUMN link_text VARCHAR(40)
           NULL
           AFTER link_url`
      },
      {
        name:
          "countdown_enabled",
        sql:
          `ALTER TABLE app_announcements
           ADD COLUMN countdown_enabled TINYINT(1)
           NOT NULL DEFAULT 0
           AFTER link_text`
      }
    ];

  for (
    const addition of additions
  ) {
    if (
      existing.has(
        addition.name
      )
    ) {
      continue;
    }

    await database.pool.query(
      addition.sql
    );
  }
}

export async function listActiveAnnouncements(
  database: AppDatabase
): Promise<AnnouncementRecord[]> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT *
       FROM app_announcements
       WHERE
         published = 1
         AND (
           starts_at IS NULL
           OR starts_at <= UTC_TIMESTAMP(3)
         )
         AND (
           ends_at IS NULL
           OR ends_at > UTC_TIMESTAMP(3)
         )
       ORDER BY
         pinned DESC,
         updated_at DESC
       LIMIT 20`
    );

  return rows.map(
    mapAnnouncement
  );
}

export async function listAdminAnnouncements(
  database: AppDatabase
): Promise<AnnouncementRecord[]> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT *
       FROM app_announcements
       ORDER BY
         pinned DESC,
         updated_at DESC
       LIMIT 200`
    );

  return rows.map(
    mapAnnouncement
  );
}

export async function createAnnouncement(
  database: AppDatabase,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<AnnouncementRecord> {
  const id = randomUUID();
  const now = new Date();

  const normalized =
    normalizeAnnouncement(
      input,
      false
    );

  validateCountdown(
    normalized
  );

  await database.pool.query(
    `INSERT INTO app_announcements
      (
        id,
        title,
        content,
        kind,
        display_mode,
        icon,
        motion,
        link_url,
        link_text,
        countdown_enabled,
        pinned,
        published,
        starts_at,
        ends_at,
        created_at,
        updated_at,
        updated_by_user_id
      )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?
     )`,
    [
      id,
      normalized.title!,
      normalized.content!,
      normalized.kind!,
      normalized.displayMode!,
      normalized.icon!,
      normalized.motion!,
      normalized.linkUrl ??
        null,
      normalized.linkText ??
        null,
      normalized.countdownEnabled
        ? 1
        : 0,
      normalized.pinned
        ? 1
        : 0,
      normalized.published
        ? 1
        : 0,
      normalized.startsAt ??
        null,
      normalized.endsAt ??
        null,
      now,
      now,
      actorUserId
    ]
  );

  return requireAnnouncement(
    database,
    id
  );
}

export async function updateAnnouncement(
  database: AppDatabase,
  id: string,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<AnnouncementRecord> {
  const current =
    await requireAnnouncement(
      database,
      id
    );

  const normalized =
    normalizeAnnouncement(
      input,
      true
    );

  const merged = {
    title:
      normalized.title ??
      current.title,
    content:
      normalized.content ??
      current.content,
    kind:
      normalized.kind ??
      current.kind,
    displayMode:
      normalized.displayMode ??
      current.displayMode,
    icon:
      normalized.icon ??
      current.icon,
    motion:
      normalized.motion ??
      current.motion,
    linkUrl:
      normalized.linkUrl ===
        undefined
        ? current.linkUrl
        : normalized.linkUrl,
    linkText:
      normalized.linkText ===
        undefined
        ? current.linkText
        : normalized.linkText,
    countdownEnabled:
      normalized.countdownEnabled ??
      current.countdownEnabled,
    startsAt:
      normalized.startsAt ===
        undefined
        ? (
            current.startsAt
              ? new Date(
                  current.startsAt
                )
              : null
          )
        : normalized.startsAt,
    endsAt:
      normalized.endsAt ===
        undefined
        ? (
            current.endsAt
              ? new Date(
                  current.endsAt
                )
              : null
          )
        : normalized.endsAt
  };

  validateCountdown(
    merged
  );

  const fields:
    string[] = [];

  const values:
    Array<
      string |
      number |
      Date |
      null
    > = [];

  for (
    const [
      key,
      column
    ] of [
      [
        "title",
        "title"
      ],
      [
        "content",
        "content"
      ],
      [
        "kind",
        "kind"
      ],
      [
        "displayMode",
        "display_mode"
      ],
      [
        "icon",
        "icon"
      ],
      [
        "motion",
        "motion"
      ],
      [
        "linkUrl",
        "link_url"
      ],
      [
        "linkText",
        "link_text"
      ],
      [
        "countdownEnabled",
        "countdown_enabled"
      ],
      [
        "pinned",
        "pinned"
      ],
      [
        "published",
        "published"
      ],
      [
        "startsAt",
        "starts_at"
      ],
      [
        "endsAt",
        "ends_at"
      ]
    ] as const
  ) {
    const value =
      normalized[key];

    if (
      value === undefined
    ) {
      continue;
    }

    fields.push(
      `${column} = ?`
    );

    if (
      key === "pinned" ||
      key === "published" ||
      key ===
        "countdownEnabled"
    ) {
      values.push(
        value === true
          ? 1
          : 0
      );
      continue;
    }

    if (
      typeof value ===
        "string" ||
      value instanceof Date ||
      value === null
    ) {
      values.push(value);
    }
  }

  if (
    fields.length === 0
  ) {
    throw new AuthError(
      400,
      "ANNOUNCEMENT_NO_CHANGES",
      "没有需要保存的公告修改"
    );
  }

  fields.push(
    "updated_at = ?",
    "updated_by_user_id = ?"
  );

  values.push(
    new Date(),
    actorUserId,
    id
  );

  await database.pool.query(
    `UPDATE app_announcements
     SET ${fields.join(", ")}
     WHERE id = ?`,
    values
  );

  return requireAnnouncement(
    database,
    id
  );
}

export async function deleteAnnouncement(
  database: AppDatabase,
  id: string
): Promise<void> {
  const [result] =
    await database.pool.execute(
      `DELETE FROM app_announcements
       WHERE id = ?`,
      [id]
    );

  const affected =
    Number(
      (
        result as {
          affectedRows?: number
        }
      ).affectedRows || 0
    );

  if (affected < 1) {
    throw new AuthError(
      404,
      "ANNOUNCEMENT_NOT_FOUND",
      "公告不存在"
    );
  }
}

async function requireAnnouncement(
  database: AppDatabase,
  id: string
): Promise<AnnouncementRecord> {
  const [rows] =
    await database.pool.query<
      RowDataPacket[]
    >(
      `SELECT *
       FROM app_announcements
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "ANNOUNCEMENT_NOT_FOUND",
      "公告不存在"
    );
  }

  return mapAnnouncement(
    rows[0]
  );
}

function normalizeAnnouncement(
  input: Record<string, unknown>,
  partial: boolean
): {
  title?: string;
  content?: string;
  kind?: AnnouncementKind;
  displayMode?:
    AnnouncementDisplayMode;
  icon?: AnnouncementIcon;
  motion?: AnnouncementMotion;
  linkUrl?: string | null;
  linkText?: string | null;
  countdownEnabled?: boolean;
  pinned?: boolean;
  published?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
} {
  const output: {
    title?: string;
    content?: string;
    kind?: AnnouncementKind;
    displayMode?:
      AnnouncementDisplayMode;
    icon?: AnnouncementIcon;
    motion?:
      AnnouncementMotion;
    linkUrl?: string | null;
    linkText?: string | null;
    countdownEnabled?: boolean;
    pinned?: boolean;
    published?: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
  } = {};

  if (
    !partial ||
    input.title !== undefined
  ) {
    output.title =
      requiredText(
        input.title,
        80,
        "公告标题"
      );
  }

  if (
    !partial ||
    input.content !== undefined
  ) {
    output.content =
      requiredText(
        input.content,
        1200,
        "公告内容"
      );
  }

  if (
    !partial ||
    input.kind !== undefined
  ) {
    output.kind =
      readKind(
        input.kind
      );
  }

  if (
    !partial ||
    input.displayMode !==
      undefined
  ) {
    output.displayMode =
      readDisplayMode(
        input.displayMode
      );
  }

  if (
    !partial ||
    input.icon !== undefined
  ) {
    output.icon =
      readIcon(
        input.icon
      );
  }

  if (
    !partial ||
    input.motion !== undefined
  ) {
    output.motion =
      readMotion(
        input.motion
      );
  }

  if (
    !partial ||
    input.linkUrl !== undefined
  ) {
    output.linkUrl =
      optionalLink(
        input.linkUrl
      );
  }

  if (
    !partial ||
    input.linkText !== undefined
  ) {
    output.linkText =
      optionalText(
        input.linkText,
        40
      ) ?? null;
  }

  if (
    !partial ||
    input.countdownEnabled !==
      undefined
  ) {
    output.countdownEnabled =
      input.countdownEnabled ===
        true;
  }

  if (
    !partial ||
    input.pinned !== undefined
  ) {
    output.pinned =
      input.pinned === true;
  }

  if (
    !partial ||
    input.published !==
      undefined
  ) {
    output.published =
      input.published === true;
  }

  if (
    !partial ||
    input.startsAt !== undefined
  ) {
    output.startsAt =
      optionalDate(
        input.startsAt,
        "公告开始时间"
      );
  }

  if (
    !partial ||
    input.endsAt !== undefined
  ) {
    output.endsAt =
      optionalDate(
        input.endsAt,
        "公告结束时间"
      );
  }

  if (
    output.startsAt instanceof
      Date &&
    output.endsAt instanceof
      Date &&
    output.endsAt.getTime() <=
      output.startsAt.getTime()
  ) {
    throw new AuthError(
      400,
      "INVALID_ANNOUNCEMENT_TIME",
      "公告结束时间必须晚于开始时间"
    );
  }

  return output;
}

function validateCountdown(
  value: {
    countdownEnabled?:
      boolean;
    endsAt?:
      Date |
      null;
  }
): void {
  if (
    value.countdownEnabled &&
    !(
      value.endsAt instanceof
      Date
    )
  ) {
    throw new AuthError(
      400,
      "ANNOUNCEMENT_COUNTDOWN_END_REQUIRED",
      "开启倒计时后必须设置结束展示时间"
    );
  }
}

function readKind(
  value: unknown
): AnnouncementKind {
  if (
    value === "warning" ||
    value === "success"
  ) {
    return value;
  }

  return "info";
}

function readDisplayMode(
  value: unknown
): AnnouncementDisplayMode {
  return value === "popup"
    ? "popup"
    : "topbar";
}

function readMotion(
  value: unknown
): AnnouncementMotion {
  if (
    value === "shimmer" ||
    value === "pulse" ||
    value === "gradient"
  ) {
    return value;
  }

  return "none";
}

function readIcon(
  value: unknown
): AnnouncementIcon {
  if (
    value === "gift" ||
    value === "sparkles" ||
    value === "bell" ||
    value === "info" ||
    value === "warning" ||
    value === "rocket" ||
    value === "clock"
  ) {
    return value;
  }

  return "megaphone";
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
      "INVALID_ANNOUNCEMENT",
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
      "INVALID_ANNOUNCEMENT",
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
    typeof value !== "string"
  ) {
    return undefined;
  }

  const text =
    value.trim();

  return text
    ? text.slice(
        0,
        max
      )
    : undefined;
}

function optionalLink(
  value: unknown
): string | null {
  const text =
    optionalText(
      value,
      800
    );

  if (!text) {
    return null;
  }

  if (
    text.startsWith("/")
  ) {
    return text;
  }

  let url: URL;

  try {
    url =
      new URL(text);
  }
  catch {
    throw new AuthError(
      400,
      "INVALID_ANNOUNCEMENT_LINK",
      "跳转链接格式不正确"
    );
  }

  if (
    url.protocol !==
      "http:" &&
    url.protocol !==
      "https:"
  ) {
    throw new AuthError(
      400,
      "INVALID_ANNOUNCEMENT_LINK",
      "跳转链接仅支持站内路径或 HTTP/HTTPS"
    );
  }

  return url.toString();
}

function optionalDate(
  value: unknown,
  label: string
): Date | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string"
  ) {
    throw new AuthError(
      400,
      "INVALID_ANNOUNCEMENT_TIME",
      `${label}不正确`
    );
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new AuthError(
      400,
      "INVALID_ANNOUNCEMENT_TIME",
      `${label}不正确`
    );
  }

  return date;
}

function mapAnnouncement(
  row: RowDataPacket
): AnnouncementRecord {
  return {
    id:
      String(row.id),
    title:
      String(row.title),
    content:
      String(row.content),
    kind:
      readKind(row.kind),
    displayMode:
      readDisplayMode(
        row.display_mode
      ),
    icon:
      readIcon(row.icon),
    motion:
      readMotion(
        row.motion
      ),
    linkUrl:
      row.link_url
        ? String(
            row.link_url
          )
        : undefined,
    linkText:
      row.link_text
        ? String(
            row.link_text
          )
        : undefined,
    countdownEnabled:
      Boolean(
        row.countdown_enabled
      ),
    pinned:
      Boolean(row.pinned),
    published:
      Boolean(
        row.published
      ),
    startsAt:
      row.starts_at
        ? mysqlDateToIso(
            row.starts_at
          )
        : undefined,
    endsAt:
      row.ends_at
        ? mysqlDateToIso(
            row.ends_at
          )
        : undefined,
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
