import {
  randomUUID
} from "node:crypto";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  withTransaction
} from "../db/database.js";
import {
  AuthError,
  type PublicUser
} from "../auth/contracts.js";

interface RegistrationSettingRow
  extends RowDataPacket {
  requires_approval: number;
  registration_bonus_enabled: number;
  registration_bonus_credit_cents: number | string;
  updated_at: string | Date;
}

interface UserBalanceRow
  extends RowDataPacket {
  id: string;
  username: string;
  credit_cents: number | string;
}

export interface RegistrationSettings {
  requiresApproval: boolean;
  registrationBonusEnabled: boolean;
  registrationBonusPoints: number;
  updatedAt: string;
}

export interface RegistrationSettingsUpdateInput {
  requiresApproval?: unknown;
  registrationBonusEnabled?: unknown;
  registrationBonusPoints?: unknown;
}

const MAX_REGISTRATION_BONUS_POINTS = 1_000_000;

export function createRegistrationSettingsService(
  database: AppDatabase
) {
  let initialized = false;

  async function initialize(): Promise<void> {
    await database.pool.query(
      `CREATE TABLE IF NOT EXISTS
         app_registration_settings (
           id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
           requires_approval TINYINT(1) NOT NULL DEFAULT 1,
           registration_bonus_enabled TINYINT(1) NOT NULL DEFAULT 0,
           registration_bonus_credit_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
           updated_by_user_id CHAR(36) NULL,
           created_at DATETIME(3) NOT NULL,
           updated_at DATETIME(3) NOT NULL
         )
         ENGINE=InnoDB
         DEFAULT CHARSET=utf8mb4
         COLLATE=utf8mb4_unicode_ci`
    );

    await ensureColumn(
      "registration_bonus_enabled",
      `registration_bonus_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER requires_approval`
    );
    await ensureColumn(
      "registration_bonus_credit_cents",
      `registration_bonus_credit_cents BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER registration_bonus_enabled`
    );

    const now = new Date();
    await database.pool.execute<ResultSetHeader>(
      `INSERT INTO app_registration_settings (
         id,
         requires_approval,
         registration_bonus_enabled,
         registration_bonus_credit_cents,
         updated_by_user_id,
         created_at,
         updated_at
       ) VALUES (1, 1, 0, 0, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE id = VALUES(id)`,
      [now, now]
    );

    initialized = true;
  }

  async function ensureColumn(
    columnName: string,
    definition: string
  ): Promise<void> {
    const [rows] = await database.pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'app_registration_settings'
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [database.databaseName, columnName]
    );
    if (!rows[0]) {
      await database.pool.query(
        `ALTER TABLE app_registration_settings ADD COLUMN ${definition}`
      );
    }
  }

  async function ensureInitialized(): Promise<void> {
    if (!initialized) await initialize();
  }

  async function get(): Promise<RegistrationSettings> {
    await ensureInitialized();
    const [rows] = await database.pool.query<RegistrationSettingRow[]>(
      `SELECT
         requires_approval,
         registration_bonus_enabled,
         registration_bonus_credit_cents,
         updated_at
       FROM app_registration_settings
       WHERE id = 1
       LIMIT 1`
    );
    const row = rows[0];
    if (!row) {
      throw new AuthError(
        503,
        "REGISTRATION_SETTINGS_MISSING",
        "注册设置尚未初始化"
      );
    }
    return {
      requiresApproval: Boolean(row.requires_approval),
      registrationBonusEnabled: Boolean(row.registration_bonus_enabled),
      registrationBonusPoints: centsToPoints(row.registration_bonus_credit_cents),
      updatedAt: toIso(row.updated_at)
    };
  }

  async function update(
    input: RegistrationSettingsUpdateInput,
    actorUserId?: string
  ): Promise<RegistrationSettings> {
    await ensureInitialized();
    const current = await get();
    const requiresApproval = readBoolean(
      input?.requiresApproval,
      current.requiresApproval,
      "注册审核开关参数不正确"
    );
    const registrationBonusEnabled = readBoolean(
      input?.registrationBonusEnabled,
      current.registrationBonusEnabled,
      "注册赠送积分开关参数不正确"
    );
    const registrationBonusCents = input?.registrationBonusPoints === undefined
      ? Math.round(current.registrationBonusPoints * 100)
      : pointsToCents(input.registrationBonusPoints);

    await database.pool.execute<ResultSetHeader>(
      `UPDATE app_registration_settings
       SET requires_approval = ?,
           registration_bonus_enabled = ?,
           registration_bonus_credit_cents = ?,
           updated_by_user_id = ?,
           updated_at = ?
       WHERE id = 1`,
      [
        requiresApproval ? 1 : 0,
        registrationBonusEnabled ? 1 : 0,
        registrationBonusCents,
        actorUserId || null,
        new Date()
      ]
    );
    return get();
  }

  async function grantRegistrationBonus(
    user: PublicUser
  ): Promise<PublicUser> {
    const settings = await get();
    const bonusCents = Math.round(settings.registrationBonusPoints * 100);
    if (
      user.role === "admin" ||
      !settings.registrationBonusEnabled ||
      bonusCents <= 0
    ) {
      return user;
    }

    return withTransaction(database.pool, async (connection) => {
      const referenceId = `registration_bonus:${user.id}`;
      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT id
         FROM app_credit_transactions
         WHERE type = 'admin_adjustment'
           AND reference_id = ?
         LIMIT 1
         FOR UPDATE`,
        [referenceId]
      );
      if (existingRows[0]) {
        return readUserWithBalance(connection, user);
      }

      const [userRows] = await connection.query<UserBalanceRow[]>(
        `SELECT id, username, credit_cents
         FROM app_users
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [user.id]
      );
      const row = userRows[0];
      if (!row) {
        throw new AuthError(404, "USER_NOT_FOUND", "注册用户不存在");
      }

      const currentBalance = Number(row.credit_cents || 0);
      const nextBalance = currentBalance + bonusCents;
      const createdAt = new Date();

      await connection.execute(
        `UPDATE app_users
         SET credit_cents = ?
         WHERE id = ?`,
        [nextBalance, user.id]
      );
      await connection.execute(
        `INSERT INTO app_credit_transactions
          (id, user_id, username, created_at, type, amount_cents,
           balance_after_cents, note, provider, model, reference_id,
           card_id, actor_user_id)
         VALUES (?, ?, ?, ?, 'admin_adjustment', ?, ?, ?, NULL, NULL, ?, NULL, NULL)`,
        [
          randomUUID(),
          user.id,
          row.username,
          createdAt,
          bonusCents,
          nextBalance,
          "新用户注册赠送",
          referenceId
        ]
      );

      return {
        ...user,
        username: row.username,
        credits: centsToPoints(nextBalance)
      };
    });
  }

  async function readUserWithBalance(
    connection: PoolConnection,
    user: PublicUser
  ): Promise<PublicUser> {
    const [rows] = await connection.query<UserBalanceRow[]>(
      `SELECT id, username, credit_cents
       FROM app_users
       WHERE id = ?
       LIMIT 1`,
      [user.id]
    );
    const row = rows[0];
    return row
      ? {
          ...user,
          username: row.username,
          credits: centsToPoints(row.credit_cents)
        }
      : user;
  }

  return {
    initialize,
    get,
    update,
    grantRegistrationBonus
  };
}

function readBoolean(
  value: unknown,
  fallback: boolean,
  message: string
): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === false) return value;
  throw new AuthError(400, "INVALID_REGISTRATION_SETTING", message);
}

function pointsToCents(value: unknown): number {
  const points = Number(value);
  if (
    !Number.isFinite(points) ||
    points < 0 ||
    points > MAX_REGISTRATION_BONUS_POINTS
  ) {
    throw new AuthError(
      400,
      "INVALID_REGISTRATION_BONUS",
      `注册赠送积分必须是 0 至 ${MAX_REGISTRATION_BONUS_POINTS} 之间的数字`
    );
  }
  return Math.round(points * 100);
}

function centsToPoints(value: number | string): number {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

export type RegistrationSettingsService =
  ReturnType<typeof createRegistrationSettingsService>;
