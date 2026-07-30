import {
  createHash,
  randomUUID
} from "node:crypto";
import type {
  PoolConnection,
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  mysqlDateToIso,
  withTransaction
} from "../db/database.js";

export type SecuritySeverity =
  | "info"
  | "warning"
  | "critical";

export interface SecurityPolicy {
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
}

export interface SecurityLimitState {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  blockedUntil?: string;
}

export interface SecurityEventInput {
  eventType: string;
  severity?: SecuritySeverity;
  success?: boolean;
  actorUserId?: string;
  username?: string;
  clientIp?: string;
  requestMethod?: string;
  requestPath?: string;
  reason?: string;
  details?: unknown;
}

export interface SecurityEventRecord {
  id: string;
  eventType: string;
  severity: SecuritySeverity;
  success: boolean;
  actorUserId?: string;
  username?: string;
  clientIp?: string;
  requestMethod?: string;
  requestPath?: string;
  reason?: string;
  details?: unknown;
  createdAt: string;
}

export interface SecuritySummary {
  activeBlocks: number;
  events24h: number;
  warnings24h: number;
  critical24h: number;
  csrfRejected24h: number;
  authBlocked24h: number;
}

interface RateLimitRow extends RowDataPacket {
  scope: string;
  key_hash: string;
  window_started_at: string;
  attempt_count: number;
  blocked_until: string | null;
  last_attempt_at: string;
}

interface EventRow extends RowDataPacket {
  id: string;
  event_type: string;
  severity: SecuritySeverity;
  success: number;
  actor_user_id: string | null;
  username: string | null;
  client_ip: string | null;
  request_method: string | null;
  request_path: string | null;
  reason: string | null;
  details_json: unknown;
  created_at: string;
}

interface CoreCollationRow extends RowDataPacket {
  COLLATION_NAME: string | null;
}

interface SecuritySummaryRow extends RowDataPacket {
  active_blocks: number | string;
  events_24h: number | string;
  warnings_24h: number | string;
  critical_24h: number | string;
  csrf_rejected_24h: number | string;
  auth_blocked_24h: number | string;
}

export function createSecurityService(
  database: AppDatabase
) {
  const { pool } = database;
  let initializationPromise:
    Promise<void> | undefined;
  let maintenanceCounter = 0;

  const policies = {
    loginIp: readPolicy(
      "AUTH_LOGIN_IP",
      15 * 60_000,
      5,
      15 * 60_000
    ),
    loginAccount: readPolicy(
      "AUTH_LOGIN_ACCOUNT",
      15 * 60_000,
      5,
      15 * 60_000
    ),
    registerIp: readPolicy(
      "AUTH_REGISTER_IP",
      60 * 60_000,
      5,
      60 * 60_000
    )
  } as const;

  function ensureInitialized(): Promise<void> {
    if (!initializationPromise) {
      initializationPromise = initialize()
        .catch((error) => {
          initializationPromise = undefined;
          console.error(
            "Security schema initialization failed",
            error
          );
          throw error;
        });
    }

    return initializationPromise;
  }

  async function initialize(): Promise<void> {
    const collation =
      await resolveCoreCollation();

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_security_rate_limits (
        scope VARCHAR(64) NOT NULL,
        key_hash CHAR(64) NOT NULL,
        window_started_at DATETIME(3) NOT NULL,
        attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
        blocked_until DATETIME(3) NULL,
        last_attempt_at DATETIME(3) NOT NULL,
        PRIMARY KEY (scope, key_hash),
        KEY idx_app_security_rate_blocked (blocked_until),
        KEY idx_app_security_rate_last (last_attempt_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_security_events (
        id CHAR(36) NOT NULL PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
        success TINYINT(1) NOT NULL DEFAULT 0,
        actor_user_id CHAR(36) NULL,
        username VARCHAR(64) NULL,
        client_ip VARCHAR(120) NULL,
        request_method VARCHAR(12) NULL,
        request_path VARCHAR(300) NULL,
        reason VARCHAR(500) NULL,
        details_json JSON NULL,
        created_at DATETIME(3) NOT NULL,
        KEY idx_app_security_event_created (created_at),
        KEY idx_app_security_event_type_created (event_type, created_at),
        KEY idx_app_security_event_severity_created (severity, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );
  }

  async function resolveCoreCollation():
    Promise<string> {
    const [rows] =
      await pool.query<CoreCollationRow[]>(
        `SELECT COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'app_users'
           AND COLUMN_NAME = 'id'
         LIMIT 1`
      );

    const value = rows[0]?.COLLATION_NAME;
    const collation =
      typeof value === "string"
        ? value
        : "utf8mb4_0900_ai_ci";

    if (!/^[A-Za-z0-9_]+$/.test(collation)) {
      throw new Error(
        "读取到无效的 MySQL 排序规则"
      );
    }

    return collation;
  }

  async function checkLimit(
    scope: string,
    key: string,
    policy: SecurityPolicy
  ): Promise<SecurityLimitState> {
    await ensureInitialized();

    const normalizedPolicy =
      normalizePolicy(policy);

    const [rows] =
      await pool.query<RateLimitRow[]>(
        `SELECT *
         FROM app_security_rate_limits
         WHERE scope = ? AND key_hash = ?
         LIMIT 1`,
        [normalizeScope(scope), hashKey(key)]
      );

    return evaluateExisting(
      rows[0],
      normalizedPolicy,
      new Date()
    );
  }

  async function consumeAttempt(
    scope: string,
    key: string,
    policy: SecurityPolicy
  ): Promise<SecurityLimitState> {
    await ensureInitialized();

    const normalizedScope =
      normalizeScope(scope);
    const keyHash = hashKey(key);
    const normalizedPolicy =
      normalizePolicy(policy);

    return withTransaction(
      pool,
      async (connection) => {
        const now = new Date();
        const row = await readLimitForUpdate(
          connection,
          normalizedScope,
          keyHash
        );

        const existing = evaluateExisting(
          row,
          normalizedPolicy,
          now
        );

        if (!existing.allowed) {
          return existing;
        }

        const windowStartedAt =
          isWindowCurrent(
            row,
            normalizedPolicy,
            now
          )
            ? parseDate(row?.window_started_at) || now
            : now;

        const attemptCount =
          isWindowCurrent(
            row,
            normalizedPolicy,
            now
          )
            ? Number(row?.attempt_count || 0) + 1
            : 1;

        const blockedUntil =
          attemptCount >=
            normalizedPolicy.maxAttempts
            ? new Date(
                now.getTime() +
                normalizedPolicy.blockMs
              )
            : null;

        await connection.execute(
          `INSERT INTO app_security_rate_limits
            (scope, key_hash, window_started_at,
             attempt_count, blocked_until,
             last_attempt_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             window_started_at = VALUES(window_started_at),
             attempt_count = VALUES(attempt_count),
             blocked_until = VALUES(blocked_until),
             last_attempt_at = VALUES(last_attempt_at)`,
          [
            normalizedScope,
            keyHash,
            windowStartedAt,
            attemptCount,
            blockedUntil,
            now
          ]
        );

        return {
          allowed: true,
          limit:
            normalizedPolicy.maxAttempts,
          remaining:
            Math.max(
              0,
              normalizedPolicy.maxAttempts -
              attemptCount
            ),
          retryAfterSeconds:
            blockedUntil
              ? Math.max(
                  1,
                  Math.ceil(
                    (blockedUntil.getTime() -
                      now.getTime()) /
                    1000
                  )
                )
              : 0,
          blockedUntil:
            blockedUntil?.toISOString()
        };
      }
    );
  }

  async function resetLimit(
    scope: string,
    key: string
  ): Promise<void> {
    await ensureInitialized();

    await pool.execute(
      `DELETE FROM app_security_rate_limits
       WHERE scope = ? AND key_hash = ?`,
      [normalizeScope(scope), hashKey(key)]
    );
  }

  async function recordEvent(
    input: SecurityEventInput
  ): Promise<void> {
    await ensureInitialized();

    const details = sanitizeDetails(
      input.details
    );

    await pool.execute(
      `INSERT INTO app_security_events
        (id, event_type, severity, success,
         actor_user_id, username, client_ip,
         request_method, request_path, reason,
         details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        normalizeText(
          input.eventType,
          80
        ) || "security.event",
        normalizeSeverity(
          input.severity
        ),
        input.success ? 1 : 0,
        normalizeText(
          input.actorUserId,
          36
        ) || null,
        normalizeText(
          input.username,
          64
        ) || null,
        normalizeText(
          input.clientIp,
          120
        ) || null,
        normalizeText(
          input.requestMethod,
          12
        ) || null,
        normalizeText(
          input.requestPath,
          300
        ) || null,
        normalizeText(
          input.reason,
          500
        ) || null,
        details === undefined
          ? null
          : JSON.stringify(details),
        new Date()
      ]
    );

    maintenanceCounter += 1;
    if (maintenanceCounter >= 200) {
      maintenanceCounter = 0;
      void cleanupExpired().catch(
        (error) => {
          console.error(
            "Security event cleanup failed",
            error
          );
        }
      );
    }
  }

  async function getSummary():
    Promise<SecuritySummary> {
    await ensureInitialized();

    const [rows] =
      await pool.query<SecuritySummaryRow[]>(
        `SELECT
           (SELECT COUNT(*)
            FROM app_security_rate_limits
            WHERE blocked_until > NOW(3))
             AS active_blocks,
           (SELECT COUNT(*)
            FROM app_security_events
            WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR))
             AS events_24h,
           (SELECT COUNT(*)
            FROM app_security_events
            WHERE severity = 'warning'
              AND created_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR))
             AS warnings_24h,
           (SELECT COUNT(*)
            FROM app_security_events
            WHERE severity = 'critical'
              AND created_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR))
             AS critical_24h,
           (SELECT COUNT(*)
            FROM app_security_events
            WHERE event_type = 'csrf.rejected'
              AND created_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR))
             AS csrf_rejected_24h,
           (SELECT COUNT(*)
            FROM app_security_events
            WHERE event_type IN (
              'auth.login_blocked',
              'auth.register_blocked'
            )
              AND created_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR))
             AS auth_blocked_24h`
      );

    const row = rows[0];

    return {
      activeBlocks:
        Number(row?.active_blocks ?? 0),
      events24h:
        Number(row?.events_24h ?? 0),
      warnings24h:
        Number(row?.warnings_24h ?? 0),
      critical24h:
        Number(row?.critical_24h ?? 0),
      csrfRejected24h:
        Number(row?.csrf_rejected_24h ?? 0),
      authBlocked24h:
        Number(row?.auth_blocked_24h ?? 0)
    };
  }

  async function listEvents(
    limit = 100
  ): Promise<SecurityEventRecord[]> {
    await ensureInitialized();

    const normalizedLimit =
      Math.max(
        1,
        Math.min(
          200,
          Number.isFinite(limit)
            ? Math.trunc(limit)
            : 100
        )
      );

    const [rows] =
      await pool.query<EventRow[]>(
        `SELECT *
         FROM app_security_events
         ORDER BY created_at DESC
         LIMIT ?`,
        [normalizedLimit]
      );

    return rows.map(toEventRecord);
  }

  async function cleanupExpired():
    Promise<void> {
    await ensureInitialized();

    const retentionDays = readPositiveEnv(
      "SECURITY_EVENT_RETENTION_DAYS",
      90,
      7,
      3650
    );

    await Promise.all([
      pool.execute(
        `DELETE FROM app_security_rate_limits
         WHERE last_attempt_at <
           DATE_SUB(NOW(3), INTERVAL 7 DAY)
           AND (
             blocked_until IS NULL OR
             blocked_until < NOW(3)
           )`
      ),
      pool.execute(
        `DELETE FROM app_security_events
         WHERE created_at <
           DATE_SUB(NOW(3), INTERVAL ${retentionDays} DAY)`
      )
    ]);
  }

  return {
    policies,
    ensureInitialized,
    checkLimit,
    consumeAttempt,
    resetLimit,
    recordEvent,
    getSummary,
    listEvents,
    cleanupExpired
  };
}

export type SecurityService =
  ReturnType<typeof createSecurityService>;

async function readLimitForUpdate(
  connection: PoolConnection,
  scope: string,
  keyHash: string
): Promise<RateLimitRow | undefined> {
  const [rows] =
    await connection.query<RateLimitRow[]>(
      `SELECT *
       FROM app_security_rate_limits
       WHERE scope = ? AND key_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [scope, keyHash]
    );

  return rows[0];
}

function evaluateExisting(
  row: RateLimitRow | undefined,
  policy: SecurityPolicy,
  now: Date
): SecurityLimitState {
  if (!row) {
    return {
      allowed: true,
      limit: policy.maxAttempts,
      remaining: policy.maxAttempts,
      retryAfterSeconds: 0
    };
  }

  const blockedUntil =
    parseDate(row.blocked_until);

  if (
    blockedUntil &&
    blockedUntil.getTime() > now.getTime()
  ) {
    return {
      allowed: false,
      limit: policy.maxAttempts,
      remaining: 0,
      retryAfterSeconds:
        Math.max(
          1,
          Math.ceil(
            (blockedUntil.getTime() -
              now.getTime()) /
            1000
          )
        ),
      blockedUntil:
        blockedUntil.toISOString()
    };
  }

  if (!isWindowCurrent(row, policy, now)) {
    return {
      allowed: true,
      limit: policy.maxAttempts,
      remaining: policy.maxAttempts,
      retryAfterSeconds: 0
    };
  }

  const count =
    Number(row.attempt_count || 0);

  if (count >= policy.maxAttempts) {
    const startedAt =
      parseDate(row.window_started_at) || now;
    const resetAt =
      new Date(
        startedAt.getTime() +
        policy.windowMs
      );

    return {
      allowed: false,
      limit: policy.maxAttempts,
      remaining: 0,
      retryAfterSeconds:
        Math.max(
          1,
          Math.ceil(
            (resetAt.getTime() -
              now.getTime()) /
            1000
          )
        ),
      blockedUntil:
        resetAt.toISOString()
    };
  }

  return {
    allowed: true,
    limit: policy.maxAttempts,
    remaining:
      Math.max(
        0,
        policy.maxAttempts - count
      ),
    retryAfterSeconds: 0
  };
}

function isWindowCurrent(
  row: RateLimitRow | undefined,
  policy: SecurityPolicy,
  now: Date
): boolean {
  if (!row) return false;

  const startedAt =
    parseDate(row.window_started_at);

  return Boolean(
    startedAt &&
    now.getTime() - startedAt.getTime() <
      policy.windowMs
  );
}

function parseDate(
  value: unknown
): Date | undefined {
  if (value instanceof Date) return value;
  const iso = mysqlDateToIso(value);
  if (!iso) return undefined;

  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : date;
}

function normalizePolicy(
  policy: SecurityPolicy
): SecurityPolicy {
  return {
    windowMs:
      positiveInteger(
        policy.windowMs,
        60_000
      ),
    maxAttempts:
      positiveInteger(
        policy.maxAttempts,
        5
      ),
    blockMs:
      positiveInteger(
        policy.blockMs,
        60_000
      )
  };
}

function readPolicy(
  prefix: string,
  defaultWindowMs: number,
  defaultMaxAttempts: number,
  defaultBlockMs: number
): SecurityPolicy {
  return {
    windowMs: readPositiveEnv(
      `${prefix}_WINDOW_MS`,
      defaultWindowMs,
      1_000,
      7 * 24 * 60 * 60_000
    ),
    maxAttempts: readPositiveEnv(
      `${prefix}_MAX_ATTEMPTS`,
      defaultMaxAttempts,
      1,
      10_000
    ),
    blockMs: readPositiveEnv(
      `${prefix}_BLOCK_MS`,
      defaultBlockMs,
      1_000,
      30 * 24 * 60 * 60_000
    )
  };
}

function readPositiveEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(
    minimum,
    Math.min(maximum, Math.trunc(value))
  );
}

function positiveInteger(
  value: number,
  fallback: number
): number {
  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

function normalizeScope(value: string): string {
  return normalizeText(value, 64) || "unknown";
}

function hashKey(value: string): string {
  return createHash("sha256")
    .update(
      value.trim().toLocaleLowerCase("en-US") ||
      "unknown"
    )
    .digest("hex");
}

function normalizeText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim();

  return normalized
    ? normalized.slice(0, maxLength)
    : undefined;
}

function normalizeSeverity(
  value: SecuritySeverity | undefined
): SecuritySeverity {
  return value === "critical" ||
    value === "warning"
    ? value
    : "info";
}

function sanitizeDetails(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 5) return "[TRUNCATED]";

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return value
      .replace(
        /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
        "Bearer [REDACTED]"
      )
      .replace(
        /(api[_-]?key|token|secret|password)=([^&\s]+)/gi,
        "$1=[REDACTED]"
      )
      .slice(0, 2000);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) =>
        sanitizeDetails(item, depth + 1)
      );
  }

  if (typeof value === "object") {
    const source =
      value as Record<string, unknown>;
    const result:
      Record<string, unknown> = {};

    for (
      const [key, item] of
      Object.entries(source).slice(0, 100)
    ) {
      if (
        /(authorization|cookie|password|secret|token|api.?key)/i
          .test(key)
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] =
          sanitizeDetails(item, depth + 1);
      }
    }

    return result;
  }

  return String(value).slice(0, 500);
}

function toEventRecord(
  row: EventRow
): SecurityEventRecord {
  let details: unknown;

  if (typeof row.details_json === "string") {
    try {
      details = JSON.parse(row.details_json);
    } catch {
      details = undefined;
    }
  } else if (row.details_json !== null) {
    details = row.details_json;
  }

  return {
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    success: Boolean(row.success),
    actorUserId:
      row.actor_user_id || undefined,
    username:
      row.username || undefined,
    clientIp:
      row.client_ip || undefined,
    requestMethod:
      row.request_method || undefined,
    requestPath:
      row.request_path || undefined,
    reason:
      row.reason || undefined,
    details,
    createdAt:
      mysqlDateToIso(row.created_at) ||
      new Date(0).toISOString()
  };
}
