import type {
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  AuthError
} from "../auth/contracts.js";

interface RegistrationSettingRow
  extends RowDataPacket {
  requires_approval: number;
  updated_at:
    string |
    Date;
}

export interface RegistrationSettings {
  requiresApproval: boolean;
  updatedAt: string;
}

export function createRegistrationSettingsService(
  database: AppDatabase
) {
  let initialized = false;

  async function initialize():
    Promise<void> {
    await database.pool.query(
      `CREATE TABLE IF NOT EXISTS
         app_registration_settings (
           id TINYINT UNSIGNED
             NOT NULL PRIMARY KEY,
           requires_approval TINYINT(1)
             NOT NULL DEFAULT 1,
           updated_by_user_id CHAR(36)
             NULL,
           created_at DATETIME(3)
             NOT NULL,
           updated_at DATETIME(3)
             NOT NULL
         )
         ENGINE=InnoDB
         DEFAULT CHARSET=utf8mb4
         COLLATE=utf8mb4_unicode_ci`
    );

    const now =
      new Date();

    await database.pool.execute<
      ResultSetHeader
    >(
      `INSERT INTO
         app_registration_settings (
           id,
           requires_approval,
           updated_by_user_id,
           created_at,
           updated_at
         ) VALUES (
           1, 1, NULL, ?, ?
         )
         ON DUPLICATE KEY UPDATE
           id = VALUES(id)`,
      [
        now,
        now
      ]
    );

    initialized = true;
  }

  async function ensureInitialized():
    Promise<void> {
    if (!initialized) {
      await initialize();
    }
  }

  async function get():
    Promise<RegistrationSettings> {
    await ensureInitialized();

    const [rows] =
      await database.pool.query<
        RegistrationSettingRow[]
      >(
        `SELECT
           requires_approval,
           updated_at
         FROM
           app_registration_settings
         WHERE
           id = 1
         LIMIT 1`
      );

    const row =
      rows[0];

    if (!row) {
      throw new AuthError(
        503,
        "REGISTRATION_SETTINGS_MISSING",
        "注册设置尚未初始化"
      );
    }

    return {
      requiresApproval:
        Boolean(
          row.requires_approval
        ),
      updatedAt:
        toIso(
          row.updated_at
        )
    };
  }

  async function update(
    requiresApprovalInput:
      unknown,
    actorUserId?: string
  ):
    Promise<RegistrationSettings> {
    await ensureInitialized();

    if (
      requiresApprovalInput !==
        true &&
      requiresApprovalInput !==
        false
    ) {
      throw new AuthError(
        400,
        "INVALID_REGISTRATION_SETTING",
        "注册审核开关参数不正确"
      );
    }

    await database.pool.execute<
      ResultSetHeader
    >(
      `UPDATE
         app_registration_settings
       SET
         requires_approval = ?,
         updated_by_user_id = ?,
         updated_at = ?
       WHERE
         id = 1`,
      [
        requiresApprovalInput
          ? 1
          : 0,
        actorUserId ||
          null,
        new Date()
      ]
    );

    return get();
  }

  return {
    initialize,
    get,
    update
  };
}

function toIso(
  value:
    string |
    Date
): string {
  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  const normalized =
    value.includes("T")
      ? value
      : `${value.replace(
          " ",
          "T"
        )}Z`;

  const date =
    new Date(normalized);

  return Number.isNaN(
    date.getTime()
  )
    ? new Date()
        .toISOString()
    : date.toISOString();
}

export type RegistrationSettingsService =
  ReturnType<
    typeof createRegistrationSettingsService
  >;
