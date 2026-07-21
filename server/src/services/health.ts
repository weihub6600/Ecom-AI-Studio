import {
  readdir,
  stat,
  statfs
} from "node:fs/promises";
import path from "node:path";
import type {
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";

export type HealthLevel =
  "ok" |
  "warning" |
  "critical";

export interface HealthServiceOptions {
  database: AppDatabase;
  generatedDir: string;
  secureCookie: boolean;
}

export function createHealthService(
  options: HealthServiceOptions
) {
  async function check() {
    const checkedAt =
      new Date().toISOString();

    const mysqlStart =
      Date.now();

    let mysqlOk = true;
    let mysqlError:
      string | undefined;

    let users = 0;
    let activeSessions = 0;
    let pendingTasks = 0;

    try {
      await options.database.pool.query(
        "SELECT 1"
      );

      const [
        [userRows],
        [sessionRows],
        [taskRows]
      ] = await Promise.all([
        options.database.pool
          .query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM app_users`
          ),
        options.database.pool
          .query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM app_sessions
             WHERE expires_at >
             UTC_TIMESTAMP()`
          ),
        options.database.pool
          .query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM app_usage_records
             WHERE status = 'submitted'`
          )
      ]);

      users =
        Number(userRows[0]?.total || 0);

      activeSessions =
        Number(sessionRows[0]?.total || 0);

      pendingTasks =
        Number(taskRows[0]?.total || 0);
    }
    catch (error) {
      mysqlOk = false;

      mysqlError =
        error instanceof Error
          ? error.message
          : "未知 MySQL 错误";
    }

    const storage =
      await readStorage(
        options.generatedDir
      );

    const warningPercent =
      readThreshold(
        process.env
          .HEALTH_DISK_WARNING_PERCENT,
        85
      );

    const criticalPercent =
      readThreshold(
        process.env
          .HEALTH_DISK_CRITICAL_PERCENT,
        95
      );

    const diskLevel: HealthLevel =
      storage.usedPercent >=
      criticalPercent
        ? "critical"
        : storage.usedPercent >=
          warningPercent
          ? "warning"
          : "ok";

    const status: HealthLevel =
      !mysqlOk ||
      diskLevel === "critical"
        ? "critical"
        : diskLevel === "warning"
          ? "warning"
          : "ok";

    const memory =
      process.memoryUsage();

    return {
      ok: status !== "critical",
      status,
      service:
        "ecom-ai-studio-api",
      checkedAt,
      uptimeSeconds:
        Math.round(process.uptime()),
      nodeVersion:
        process.version,
      environment:
        process.env.NODE_ENV ||
        "development",
      security: {
        secureCookie:
          options.secureCookie
      },
      process: {
        pid: process.pid,
        rssBytes: memory.rss,
        heapUsedBytes:
          memory.heapUsed,
        heapTotalBytes:
          memory.heapTotal
      },
      mysql: {
        ok: mysqlOk,
        latencyMs:
          Date.now() - mysqlStart,
        users,
        activeSessions,
        pendingTasks,
        error: mysqlError
      },
      storage: {
        generatedDir:
          options.generatedDir,
        fileCount:
          storage.fileCount,
        generatedBytes:
          storage.generatedBytes,
        diskTotalBytes:
          storage.diskTotalBytes,
        diskFreeBytes:
          storage.diskFreeBytes,
        usedPercent:
          storage.usedPercent,
        level: diskLevel
      }
    };
  }

  return {
    check
  };
}

async function readStorage(
  generatedDir: string
) {
  let fileCount = 0;
  let generatedBytes = 0;

  try {
    const entries =
      await readdir(
        generatedDir,
        {
          withFileTypes: true
        }
      );

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const information =
        await stat(
          path.join(
            generatedDir,
            entry.name
          )
        );

      fileCount += 1;
      generatedBytes +=
        information.size;
    }
  }
  catch {
    fileCount = 0;
    generatedBytes = 0;
  }

  try {
    const fileSystem =
      await statfs(generatedDir);

    const blockSize =
      Number(fileSystem.bsize);

    const total =
      Number(fileSystem.blocks) *
      blockSize;

    const free =
      Number(fileSystem.bavail) *
      blockSize;

    const usedPercent =
      total > 0
        ? Number(
            (
              (
                (total - free) /
                total
              ) * 100
            ).toFixed(2)
          )
        : 0;

    return {
      fileCount,
      generatedBytes,
      diskTotalBytes: total,
      diskFreeBytes: free,
      usedPercent
    };
  }
  catch {
    return {
      fileCount,
      generatedBytes,
      diskTotalBytes: 0,
      diskFreeBytes: 0,
      usedPercent: 0
    };
  }
}

function readThreshold(
  value: string | undefined,
  fallback: number
): number {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? Math.min(
        100,
        Math.max(1, numeric)
      )
    : fallback;
}

export type HealthService =
  ReturnType<typeof createHealthService>;