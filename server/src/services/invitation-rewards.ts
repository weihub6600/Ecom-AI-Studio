import {
  randomBytes,
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
  type PublicUser,
  type UserRole,
  type UserStatus
} from "../auth/contracts.js";

export type InvitationRewardTrigger =
  | "registration"
  | "activation";

export interface InvitationRewardSettings {
  enabled: boolean;
  inviterRewardPoints: number;
  inviteeRewardPoints: number;
  rewardTrigger: InvitationRewardTrigger;
  rewardTitle: string;
  rewardDescription: string;
  updatedAt: string;
}

export interface InvitationRewardUpdateInput {
  enabled?: unknown;
  inviterRewardPoints?: unknown;
  inviteeRewardPoints?: unknown;
  rewardTrigger?: unknown;
  rewardTitle?: unknown;
  rewardDescription?: unknown;
}

interface SettingsRow extends RowDataPacket {
  enabled: number;
  inviter_reward_cents: number | string;
  invitee_reward_cents: number | string;
  reward_trigger: InvitationRewardTrigger;
  reward_title: string;
  reward_description: string;
  updated_at: string | Date;
}

interface InvitationCodeRow extends RowDataPacket {
  user_id: string;
  code: string;
  username: string;
  role: UserRole;
  status: UserStatus;
}

interface InvitationRow extends RowDataPacket {
  id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  invite_code: string;
  status: "pending" | "rewarded";
  inviter_reward_cents: number | string;
  invitee_reward_cents: number | string;
  reward_trigger: InvitationRewardTrigger;
  created_at: string | Date;
  rewarded_at: string | Date | null;
}

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  created_at: string | Date;
  approved_at: string | Date | null;
  last_login_at: string | Date | null;
  credit_cents: number | string;
}

const MAX_REWARD_POINTS = 1_000_000;
const INVITE_ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function createInvitationRewardService(
  database: AppDatabase
) {
  let initialized = false;

  async function initialize(): Promise<void> {
    await database.pool.query(
      `CREATE TABLE IF NOT EXISTS
         app_invitation_settings (
           id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
           enabled TINYINT(1) NOT NULL DEFAULT 0,
           inviter_reward_cents BIGINT UNSIGNED NOT NULL DEFAULT 1000,
           invitee_reward_cents BIGINT UNSIGNED NOT NULL DEFAULT 500,
           reward_trigger ENUM('registration','activation') NOT NULL DEFAULT 'activation',
           reward_title VARCHAR(120) NOT NULL DEFAULT '邀请好友，双方得积分',
           reward_description VARCHAR(500) NOT NULL DEFAULT '好友通过你的邀请链接注册并满足奖励条件后，双方自动获得积分。',
           updated_by_user_id CHAR(36) NULL,
           created_at DATETIME(3) NOT NULL,
           updated_at DATETIME(3) NOT NULL
         )
         ENGINE=InnoDB
         DEFAULT CHARSET=utf8mb4
         COLLATE=utf8mb4_0900_ai_ci`
    );

    await database.pool.query(
      `CREATE TABLE IF NOT EXISTS
         app_invitation_codes (
           user_id CHAR(36) NOT NULL PRIMARY KEY,
           code VARCHAR(24) NOT NULL,
           created_at DATETIME(3) NOT NULL,
           UNIQUE KEY uq_app_invitation_code (code),
           CONSTRAINT fk_app_invitation_code_user
             FOREIGN KEY (user_id)
             REFERENCES app_users(id)
             ON DELETE CASCADE
         )
         ENGINE=InnoDB
         DEFAULT CHARSET=utf8mb4
         COLLATE=utf8mb4_0900_ai_ci`
    );

    await database.pool.query(
      `CREATE TABLE IF NOT EXISTS
         app_invitations (
           id CHAR(36) NOT NULL PRIMARY KEY,
           inviter_user_id CHAR(36) NOT NULL,
           invitee_user_id CHAR(36) NOT NULL,
           invite_code VARCHAR(24) NOT NULL,
           status ENUM('pending','rewarded') NOT NULL DEFAULT 'pending',
           inviter_reward_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
           invitee_reward_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
           reward_trigger ENUM('registration','activation') NOT NULL DEFAULT 'activation',
           created_at DATETIME(3) NOT NULL,
           rewarded_at DATETIME(3) NULL,
           UNIQUE KEY uq_app_invitation_invitee (invitee_user_id),
           KEY idx_app_invitation_inviter_created (inviter_user_id, created_at),
           KEY idx_app_invitation_status_created (status, created_at),
           CONSTRAINT fk_app_invitation_inviter
             FOREIGN KEY (inviter_user_id)
             REFERENCES app_users(id)
             ON DELETE CASCADE,
           CONSTRAINT fk_app_invitation_invitee
             FOREIGN KEY (invitee_user_id)
             REFERENCES app_users(id)
             ON DELETE CASCADE
         )
         ENGINE=InnoDB
         DEFAULT CHARSET=utf8mb4
         COLLATE=utf8mb4_0900_ai_ci`
    );

    const now = new Date();
    await database.pool.execute<ResultSetHeader>(
      `INSERT INTO app_invitation_settings (
         id,
         enabled,
         inviter_reward_cents,
         invitee_reward_cents,
         reward_trigger,
         reward_title,
         reward_description,
         updated_by_user_id,
         created_at,
         updated_at
       ) VALUES (
         1, 0, 1000, 500, 'activation',
         '邀请好友，双方得积分',
         '好友通过你的邀请链接注册并满足奖励条件后，双方自动获得积分。',
         NULL, ?, ?
       )
       ON DUPLICATE KEY UPDATE id = VALUES(id)`,
      [now, now]
    );

    initialized = true;
  }

  async function ensureInitialized(): Promise<void> {
    if (!initialized) {
      await initialize();
    }
  }

  async function getSettings():
    Promise<InvitationRewardSettings> {
    await ensureInitialized();

    const [rows] =
      await database.pool.query<
        SettingsRow[]
      >(
        `SELECT
           enabled,
           inviter_reward_cents,
           invitee_reward_cents,
           reward_trigger,
           reward_title,
           reward_description,
           updated_at
         FROM app_invitation_settings
         WHERE id = 1
         LIMIT 1`
      );

    const row = rows[0];
    if (!row) {
      throw new AuthError(
        503,
        "INVITATION_SETTINGS_MISSING",
        "邀请奖励设置尚未初始化"
      );
    }

    return {
      enabled: Boolean(row.enabled),
      inviterRewardPoints:
        centsToPoints(
          row.inviter_reward_cents
        ),
      inviteeRewardPoints:
        centsToPoints(
          row.invitee_reward_cents
        ),
      rewardTrigger:
        row.reward_trigger,
      rewardTitle:
        row.reward_title,
      rewardDescription:
        row.reward_description,
      updatedAt:
        toIso(row.updated_at) ||
        new Date().toISOString()
    };
  }

  async function getPublicSettings():
    Promise<InvitationRewardSettings> {
    return getSettings();
  }

  async function updateSettings(
    input: InvitationRewardUpdateInput,
    actorUserId?: string
  ): Promise<InvitationRewardSettings> {
    const current =
      await getSettings();

    const enabled =
      readBoolean(
        input?.enabled,
        current.enabled,
        "邀请奖励开关参数不正确"
      );

    const inviterRewardCents =
      input?.inviterRewardPoints ===
        undefined
        ? pointsToCents(
            current.inviterRewardPoints
          )
        : pointsToCents(
            input.inviterRewardPoints
          );

    const inviteeRewardCents =
      input?.inviteeRewardPoints ===
        undefined
        ? pointsToCents(
            current.inviteeRewardPoints
          )
        : pointsToCents(
            input.inviteeRewardPoints
          );

    const rewardTrigger =
      readRewardTrigger(
        input?.rewardTrigger,
        current.rewardTrigger
      );

    const rewardTitle =
      readText(
        input?.rewardTitle,
        current.rewardTitle,
        120,
        "邀请活动标题不能为空"
      );

    const rewardDescription =
      readText(
        input?.rewardDescription,
        current.rewardDescription,
        500,
        "邀请活动说明不能为空"
      );

    await database.pool.execute(
      `UPDATE app_invitation_settings
       SET
         enabled = ?,
         inviter_reward_cents = ?,
         invitee_reward_cents = ?,
         reward_trigger = ?,
         reward_title = ?,
         reward_description = ?,
         updated_by_user_id = ?,
         updated_at = ?
       WHERE id = 1`,
      [
        enabled ? 1 : 0,
        inviterRewardCents,
        inviteeRewardCents,
        rewardTrigger,
        rewardTitle,
        rewardDescription,
        actorUserId || null,
        new Date()
      ]
    );

    return getSettings();
  }

  async function getOrCreateInviteCode(
    userId: string
  ): Promise<string> {
    await ensureInitialized();

    return withTransaction(
      database.pool,
      async (connection) => {
        const [existingRows] =
          await connection.query<
            RowDataPacket[]
          >(
            `SELECT code
             FROM app_invitation_codes
             WHERE user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [userId]
          );

        if (existingRows[0]?.code) {
          return String(
            existingRows[0].code
          );
        }

        const [userRows] =
          await connection.query<
            RowDataPacket[]
          >(
            `SELECT id
             FROM app_users
             WHERE id = ?
             LIMIT 1
             FOR UPDATE`,
            [userId]
          );

        if (!userRows[0]) {
          throw new AuthError(
            404,
            "USER_NOT_FOUND",
            "用户不存在"
          );
        }

        for (
          let attempt = 0;
          attempt < 30;
          attempt += 1
        ) {
          const code = createInviteCode();

          try {
            await connection.execute(
              `INSERT INTO app_invitation_codes (
                 user_id,
                 code,
                 created_at
               ) VALUES (?, ?, ?)`,
              [
                userId,
                code,
                new Date()
              ]
            );

            return code;
          }
          catch (error) {
            if (!isDuplicateEntry(error)) {
              throw error;
            }

            const [racedRows] =
              await connection.query<
                RowDataPacket[]
              >(
                `SELECT code
                 FROM app_invitation_codes
                 WHERE user_id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [userId]
              );

            if (racedRows[0]?.code) {
              return String(
                racedRows[0].code
              );
            }
          }
        }

        throw new AuthError(
          503,
          "INVITE_CODE_GENERATION_FAILED",
          "邀请码生成失败，请稍后重试"
        );
      }
    );
  }

  async function recordRegistration(
    user: PublicUser,
    inviteCodeInput: unknown
  ): Promise<PublicUser> {
    const rawCode =
      typeof inviteCodeInput ===
        "string"
        ? inviteCodeInput.trim()
        : "";

    if (!rawCode) {
      return user;
    }

    const settings =
      await getSettings();

    if (!settings.enabled) {
      return user;
    }

    const inviteCode =
      normalizeInviteCode(rawCode);

    return withTransaction(
      database.pool,
      async (connection) => {
        const [codeRows] =
          await connection.query<
            InvitationCodeRow[]
          >(
            `SELECT
               c.user_id,
               c.code,
               u.username,
               u.role,
               u.status
             FROM app_invitation_codes c
             INNER JOIN app_users u
               ON u.id = c.user_id
             WHERE c.code = ?
             LIMIT 1
             FOR UPDATE`,
            [inviteCode]
          );

        const codeRow = codeRows[0];
        if (!codeRow) {
          return readPublicUser(
            connection,
            user.id
          );
        }

        if (
          codeRow.user_id === user.id
        ) {
          throw new AuthError(
            400,
            "SELF_INVITATION_NOT_ALLOWED",
            "不能使用自己的邀请码"
          );
        }

        const [existingRows] =
          await connection.query<
            InvitationRow[]
          >(
            `SELECT *
             FROM app_invitations
             WHERE invitee_user_id = ?
             LIMIT 1
             FOR UPDATE`,
            [user.id]
          );

        let invitation =
          existingRows[0];

        if (!invitation) {
          const invitationId =
            randomUUID();

          await connection.execute(
            `INSERT INTO app_invitations (
               id,
               inviter_user_id,
               invitee_user_id,
               invite_code,
               status,
               inviter_reward_cents,
               invitee_reward_cents,
               reward_trigger,
               created_at,
               rewarded_at
             ) VALUES (
               ?, ?, ?, ?, 'pending',
               ?, ?, ?, ?, NULL
             )`,
            [
              invitationId,
              codeRow.user_id,
              user.id,
              inviteCode,
              pointsToCents(
                settings.inviterRewardPoints
              ),
              pointsToCents(
                settings.inviteeRewardPoints
              ),
              settings.rewardTrigger,
              new Date()
            ]
          );

          invitation = {
            id: invitationId,
            inviter_user_id:
              codeRow.user_id,
            invitee_user_id:
              user.id,
            invite_code:
              inviteCode,
            status: "pending",
            inviter_reward_cents:
              pointsToCents(
                settings.inviterRewardPoints
              ),
            invitee_reward_cents:
              pointsToCents(
                settings.inviteeRewardPoints
              ),
            reward_trigger:
              settings.rewardTrigger,
            created_at:
              new Date(),
            rewarded_at: null
          } as InvitationRow;
        }

        if (
          invitation.status ===
            "pending" &&
          (
            invitation.reward_trigger ===
              "registration" ||
            user.status === "active"
          )
        ) {
          await awardInvitation(
            connection,
            invitation
          );
        }

        return readPublicUser(
          connection,
          user.id
        );
      }
    );
  }

  async function rewardActivatedUser(
    userId: string
  ): Promise<PublicUser | undefined> {
    await ensureInitialized();

    return withTransaction(
      database.pool,
      async (connection) => {
        const [invitationRows] =
          await connection.query<
            InvitationRow[]
          >(
            `SELECT *
             FROM app_invitations
             WHERE
               invitee_user_id = ?
               AND status = 'pending'
               AND reward_trigger = 'activation'
             LIMIT 1
             FOR UPDATE`,
            [userId]
          );

        const invitation =
          invitationRows[0];

        if (invitation) {
          const user =
            await readPublicUser(
              connection,
              userId
            );

          if (user.status === "active") {
            await awardInvitation(
              connection,
              invitation
            );
          }
        }

        const [userRows] =
          await connection.query<
            UserRow[]
          >(
            `SELECT *
             FROM app_users
             WHERE id = ?
             LIMIT 1`,
            [userId]
          );

        return userRows[0]
          ? toPublicUser(userRows[0])
          : undefined;
      }
    );
  }

  async function getUserDashboard(
    userId: string
  ) {
    const [settings, code] =
      await Promise.all([
        getSettings(),
        getOrCreateInviteCode(userId)
      ]);

    const [summaryRows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT
           COUNT(*) AS total_count,
           SUM(
             CASE
               WHEN status = 'rewarded'
               THEN 1 ELSE 0
             END
           ) AS rewarded_count,
           SUM(
             CASE
               WHEN status = 'pending'
               THEN 1 ELSE 0
             END
           ) AS pending_count,
           COALESCE(
             SUM(
               CASE
                 WHEN status = 'rewarded'
                 THEN inviter_reward_cents
                 ELSE 0
               END
             ),
             0
           ) AS earned_cents
         FROM app_invitations
         WHERE inviter_user_id = ?`,
        [userId]
      );

    const [recentRows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT
           i.id,
           u.username,
           i.status,
           i.inviter_reward_cents,
           i.created_at,
           i.rewarded_at
         FROM app_invitations i
         INNER JOIN app_users u
           ON u.id = i.invitee_user_id
         WHERE i.inviter_user_id = ?
         ORDER BY i.created_at DESC
         LIMIT 50`,
        [userId]
      );

    const summary =
      (summaryRows[0] || {}) as RowDataPacket;

    return {
      settings,
      code,
      summary: {
        total:
          Number(
            summary.total_count || 0
          ),
        rewarded:
          Number(
            summary.rewarded_count || 0
          ),
        pending:
          Number(
            summary.pending_count || 0
          ),
        earnedPoints:
          centsToPoints(
            summary.earned_cents || 0
          )
      },
      recent:
        recentRows.map((row) => ({
          id: String(row.id),
          username:
            String(row.username),
          status:
            row.status === "rewarded"
              ? "rewarded"
              : "pending",
          rewardPoints:
            centsToPoints(
              row.inviter_reward_cents || 0
            ),
          createdAt:
            toIso(row.created_at) ||
            new Date().toISOString(),
          rewardedAt:
            toIso(row.rewarded_at)
        }))
    };
  }

  async function getAdminDashboard() {
    const settings =
      await getSettings();

    const [summaryRows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT
           COUNT(*) AS total_count,
           SUM(
             CASE
               WHEN status = 'rewarded'
               THEN 1 ELSE 0
             END
           ) AS rewarded_count,
           SUM(
             CASE
               WHEN status = 'pending'
               THEN 1 ELSE 0
             END
           ) AS pending_count,
           COALESCE(
             SUM(
               CASE
                 WHEN status = 'rewarded'
                 THEN inviter_reward_cents + invitee_reward_cents
                 ELSE 0
               END
             ),
             0
           ) AS issued_cents
         FROM app_invitations`
      );

    const [recentRows] =
      await database.pool.query<
        RowDataPacket[]
      >(
        `SELECT
           i.id,
           inviter.username AS inviter_username,
           invitee.username AS invitee_username,
           i.status,
           i.inviter_reward_cents,
           i.invitee_reward_cents,
           i.created_at,
           i.rewarded_at
         FROM app_invitations i
         INNER JOIN app_users inviter
           ON inviter.id = i.inviter_user_id
         INNER JOIN app_users invitee
           ON invitee.id = i.invitee_user_id
         ORDER BY i.created_at DESC
         LIMIT 30`
      );

    const summary =
      (summaryRows[0] || {}) as RowDataPacket;

    return {
      settings,
      summary: {
        total:
          Number(
            summary.total_count || 0
          ),
        rewarded:
          Number(
            summary.rewarded_count || 0
          ),
        pending:
          Number(
            summary.pending_count || 0
          ),
        issuedPoints:
          centsToPoints(
            summary.issued_cents || 0
          )
      },
      recent:
        recentRows.map((row) => ({
          id: String(row.id),
          inviterUsername:
            String(
              row.inviter_username
            ),
          inviteeUsername:
            String(
              row.invitee_username
            ),
          status:
            row.status === "rewarded"
              ? "rewarded"
              : "pending",
          inviterRewardPoints:
            centsToPoints(
              row.inviter_reward_cents || 0
            ),
          inviteeRewardPoints:
            centsToPoints(
              row.invitee_reward_cents || 0
            ),
          createdAt:
            toIso(row.created_at) ||
            new Date().toISOString(),
          rewardedAt:
            toIso(row.rewarded_at)
        }))
    };
  }

  async function awardInvitation(
    connection: PoolConnection,
    invitation: InvitationRow
  ): Promise<void> {
    if (invitation.status === "rewarded") {
      return;
    }

    const [userRows] =
      await connection.query<
        UserRow[]
      >(
        `SELECT *
         FROM app_users
         WHERE id IN (?, ?)
         ORDER BY id
         FOR UPDATE`,
        [
          invitation.inviter_user_id,
          invitation.invitee_user_id
        ]
      );

    const inviter =
      userRows.find(
        (row) =>
          row.id ===
          invitation.inviter_user_id
      );

    const invitee =
      userRows.find(
        (row) =>
          row.id ===
          invitation.invitee_user_id
      );

    if (!inviter || !invitee) {
      throw new AuthError(
        404,
        "INVITATION_USER_NOT_FOUND",
        "邀请关系中的用户不存在"
      );
    }

    if (
      invitation.reward_trigger ===
        "activation" &&
      invitee.status !== "active"
    ) {
      return;
    }

    const inviterRewardCents =
      Number(
        invitation.inviter_reward_cents || 0
      );

    const inviteeRewardCents =
      Number(
        invitation.invitee_reward_cents || 0
      );

    const inviterBalance =
      Number(inviter.credit_cents || 0) +
      inviterRewardCents;

    const inviteeBalance =
      Number(invitee.credit_cents || 0) +
      inviteeRewardCents;

    const now = new Date();

    if (inviterRewardCents > 0) {
      await connection.execute(
        `UPDATE app_users
         SET credit_cents = ?
         WHERE id = ?`,
        [
          inviterBalance,
          inviter.id
        ]
      );

      await insertRewardTransaction(
        connection,
        {
          userId: inviter.id,
          username: inviter.username,
          amountCents:
            inviterRewardCents,
          balanceAfterCents:
            inviterBalance,
          note:
            `邀请奖励：成功邀请 ${invitee.username}`,
          referenceId:
            `invitation:${invitation.id}:inviter`,
          createdAt: now
        }
      );
    }

    if (inviteeRewardCents > 0) {
      await connection.execute(
        `UPDATE app_users
         SET credit_cents = ?
         WHERE id = ?`,
        [
          inviteeBalance,
          invitee.id
        ]
      );

      await insertRewardTransaction(
        connection,
        {
          userId: invitee.id,
          username: invitee.username,
          amountCents:
            inviteeRewardCents,
          balanceAfterCents:
            inviteeBalance,
          note:
            `受邀新人奖励：邀请人 ${inviter.username}`,
          referenceId:
            `invitation:${invitation.id}:invitee`,
          createdAt: now
        }
      );
    }

    await connection.execute(
      `UPDATE app_invitations
       SET
         status = 'rewarded',
         rewarded_at = ?
       WHERE
         id = ?
         AND status = 'pending'`,
      [now, invitation.id]
    );
  }

  return {
    initialize,
    getSettings,
    getPublicSettings,
    updateSettings,
    getOrCreateInviteCode,
    recordRegistration,
    rewardActivatedUser,
    getUserDashboard,
    getAdminDashboard
  };
}

async function insertRewardTransaction(
  connection: PoolConnection,
  input: {
    userId: string;
    username: string;
    amountCents: number;
    balanceAfterCents: number;
    note: string;
    referenceId: string;
    createdAt: Date;
  }
): Promise<void> {
  await connection.execute(
    `INSERT INTO app_credit_transactions (
       id,
       user_id,
       username,
       created_at,
       type,
       amount_cents,
       balance_after_cents,
       note,
       provider,
       model,
       reference_id,
       card_id,
       actor_user_id
     ) VALUES (
       ?, ?, ?, ?, 'admin_adjustment',
       ?, ?, ?, NULL, NULL, ?, NULL, NULL
     )`,
    [
      randomUUID(),
      input.userId,
      input.username,
      input.createdAt,
      input.amountCents,
      input.balanceAfterCents,
      input.note,
      input.referenceId
    ]
  );
}

async function readPublicUser(
  connection: PoolConnection,
  userId: string
): Promise<PublicUser> {
  const [rows] =
    await connection.query<
      UserRow[]
    >(
      `SELECT *
       FROM app_users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );

  const row = rows[0];
  if (!row) {
    throw new AuthError(
      404,
      "USER_NOT_FOUND",
      "用户不存在"
    );
  }

  return toPublicUser(row);
}

function toPublicUser(
  row: UserRow
): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt:
      toIso(row.created_at) ||
      new Date().toISOString(),
    approvedAt:
      toIso(row.approved_at),
    lastLoginAt:
      toIso(row.last_login_at),
    credits:
      centsToPoints(row.credit_cents)
  };
}

function createInviteCode(): string {
  const bytes = randomBytes(8);
  let output = "ZHE-";

  for (
    let index = 0;
    index < 8;
    index += 1
  ) {
    output +=
      INVITE_ALPHABET.charAt(
        bytes[index]! %
        INVITE_ALPHABET.length
      );
  }

  return output;
}

function normalizeInviteCode(
  value: unknown
): string {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "INVALID_INVITE_CODE",
      "邀请码格式不正确"
    );
  }

  const normalized =
    value
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");

  if (
    !/^ZHE-[2-9A-HJ-NP-Z]{8}$/
      .test(normalized)
  ) {
    throw new AuthError(
      400,
      "INVALID_INVITE_CODE",
      "邀请码格式不正确"
    );
  }

  return normalized;
}

function readBoolean(
  value: unknown,
  fallback: boolean,
  message: string
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  throw new AuthError(
    400,
    "INVALID_INVITATION_SETTING",
    message
  );
}

function readRewardTrigger(
  value: unknown,
  fallback: InvitationRewardTrigger
): InvitationRewardTrigger {
  if (value === undefined) {
    return fallback;
  }

  if (
    value === "registration" ||
    value === "activation"
  ) {
    return value;
  }

  throw new AuthError(
    400,
    "INVALID_INVITATION_TRIGGER",
    "邀请奖励发放时机不正确"
  );
}

function readText(
  value: unknown,
  fallback: string,
  maxLength: number,
  emptyMessage: string
): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "INVALID_INVITATION_TEXT",
      emptyMessage
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new AuthError(
      400,
      "INVALID_INVITATION_TEXT",
      emptyMessage
    );
  }

  return normalized.slice(0, maxLength);
}

function pointsToCents(
  value: unknown
): number {
  const points = Number(value);

  if (
    !Number.isFinite(points) ||
    points < 0 ||
    points > MAX_REWARD_POINTS
  ) {
    throw new AuthError(
      400,
      "INVALID_INVITATION_REWARD",
      `邀请奖励积分必须是 0 至 ${MAX_REWARD_POINTS} 之间的数字`
    );
  }

  return Math.round(points * 100);
}

function centsToPoints(
  value: number | string
): number {
  return Number(
    (
      Number(value || 0) /
      100
    ).toFixed(2)
  );
}

function toIso(
  value:
    | string
    | Date
    | null
    | undefined
): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized =
    value.includes("T")
      ? value
      : `${value.replace(" ", "T")}Z`;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

function isDuplicateEntry(
  error: unknown
): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown })
      .code === "ER_DUP_ENTRY"
  );
}

export type InvitationRewardService =
  ReturnType<
    typeof createInvitationRewardService
  >;
