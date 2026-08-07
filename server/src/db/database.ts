import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type RowDataPacket
} from "mysql2/promise";
import { SCHEMA_STATEMENTS } from "./schema.js";

export interface AppDatabase {
  pool: Pool;
  databaseName: string;
  storageLabel: string;
  close(): Promise<void>;
}

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  autoCreateDatabase: boolean;
  ssl: boolean;
}

export async function createAppDatabase(): Promise<AppDatabase> {
  const config = readDatabaseConfig();
  const maxAttempts = positiveInteger(
    process.env.MYSQL_STARTUP_RETRY_ATTEMPTS,
    12
  );
  const baseDelayMs = positiveInteger(
    process.env.MYSQL_STARTUP_RETRY_BASE_MS,
    1_000
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    positiveInteger(
      process.env.MYSQL_STARTUP_RETRY_MAX_MS,
      5_000
    )
  );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    let pool: Pool | undefined;

    try {
      if (config.autoCreateDatabase) {
        await ensureDatabaseExists(config);
      }

      pool = mysql.createPool(
        createPoolOptions(config, true)
      );

      await pool.query("SELECT 1");

      for (const statement of SCHEMA_STATEMENTS) {
        await pool.query(statement);
      }

      if (attempt > 1) {
        console.log(
          `MySQL 已恢复连接，第 ${attempt} 次尝试成功`
        );
      }

      const readyPool = pool;

      return {
        pool: readyPool,
        databaseName: config.database,
        storageLabel:
          `mysql://${config.host}:${config.port}/${config.database}`,
        close: () => readyPool.end()
      };
    }
    catch (error) {
      if (pool) {
        await pool.end()
          .catch(() => undefined);
      }

      const retryable =
        isRetryableDatabaseError(error);

      if (
        !retryable ||
        attempt >= maxAttempts
      ) {
        throw error;
      }

      const delayMs = Math.min(
        maxDelayMs,
        baseDelayMs *
          2 ** Math.min(attempt - 1, 10)
      );

      console.warn(
        `MySQL 暂不可用（第 ${attempt}/${maxAttempts} 次），${delayMs}ms 后重试：${databaseErrorMessage(error)}`
      );

      await wait(delayMs);
    }
  }

  throw new Error(
    "MySQL 初始化失败"
  );
}

export async function withTransaction<T>(
  pool: Pool,
  task: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await task(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function hasMigration(pool: Pool, migrationKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT migration_key FROM app_schema_migrations WHERE migration_key = ? LIMIT 1",
    [migrationKey]
  );
  return rows.length > 0;
}

export function mysqlDateToIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function asNullableDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readDatabaseConfig(): DatabaseConfig {
  const database = (process.env.MYSQL_DATABASE || "ecom_ai_studio").trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) {
    throw new Error("MYSQL_DATABASE 只能包含字母、数字和下划线，且长度不能超过 64 位");
  }

  const user = (process.env.MYSQL_USER || "root").trim();
  if (!user) throw new Error("MYSQL_USER 不能为空");

  return {
    host: (process.env.MYSQL_HOST || "127.0.0.1").trim(),
    port: positiveInteger(process.env.MYSQL_PORT, 3306),
    user,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    connectionLimit: positiveInteger(process.env.MYSQL_CONNECTION_LIMIT, 10),
    autoCreateDatabase: process.env.MYSQL_AUTO_CREATE_DATABASE !== "false",
    ssl: process.env.MYSQL_SSL === "true"
  };
}

async function ensureDatabaseExists(config: DatabaseConfig): Promise<void> {
  const connection = await mysql.createConnection(createPoolOptions(config, false));
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
  } finally {
    await connection.end();
  }
}

function createPoolOptions(config: DatabaseConfig, includeDatabase: boolean): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: includeDatabase ? config.database : undefined,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    decimalNumbers: true,
    ssl: config.ssl ? {} : undefined
  };
}

function isRetryableDatabaseError(
  error: unknown
): boolean {
  if (
    !error ||
    typeof error !== "object"
  ) {
    return false;
  }

  const code =
    "code" in error
      ? String(
          (error as { code?: unknown })
            .code || ""
        )
      : "";

  return new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "EPIPE",
    "PROTOCOL_CONNECTION_LOST",
    "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
    "ER_CON_COUNT_ERROR",
    "ER_SERVER_SHUTDOWN"
  ]).has(code);
}

function databaseErrorMessage(
  error: unknown
): string {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }

  return String(error)
    .slice(0, 300);
}

function wait(
  delayMs: number
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        delayMs
      );
    }
  );
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}
