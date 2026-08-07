import {
  readdir,
  stat,
  statfs
} from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import type { AppDatabase } from "../db/database.js";

export type HealthLevel = "ok" | "warning" | "critical";

export interface HealthServiceOptions {
  database: AppDatabase;
  generatedDir: string;
  secureCookie: boolean;
}

export function createHealthService(options: HealthServiceOptions) {
  async function checkPublic() {
    const mysqlOk = await probeMysql(options.database);
    const disk = await readDiskUsage(options.generatedDir);
    const diskLevel = resolveDiskLevel(disk.ok, disk.usedPercent);
    const status: HealthLevel =
      !mysqlOk || diskLevel === "critical"
        ? "critical"
        : diskLevel === "warning"
          ? "warning"
          : "ok";

    return {
      ok: status !== "critical",
      status,
      service: "ecom-ai-studio-api",
      checkedAt: new Date().toISOString(),
      checks: {
        mysql: mysqlOk,
        storage: disk.ok && diskLevel !== "critical"
      }
    };
  }

  async function check() {
    const checkedAt = new Date().toISOString();
    const mysqlStart = Date.now();
    let mysqlOk = true;
    let mysqlError: string | undefined;
    let users = 0;
    let activeSessions = 0;
    let pendingTasks = 0;

    try {
      await options.database.pool.query("SELECT 1");
      const [[userRows], [sessionRows], [taskRows]] = await Promise.all([
        options.database.pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total FROM app_users`
        ),
        options.database.pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total
           FROM app_sessions
           WHERE expires_at > UTC_TIMESTAMP()`
        ),
        options.database.pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total
           FROM app_usage_records
           WHERE status = 'submitted'`
        )
      ]);
      users = Number(userRows[0]?.total || 0);
      activeSessions = Number(sessionRows[0]?.total || 0);
      pendingTasks = Number(taskRows[0]?.total || 0);
    } catch (error) {
      mysqlOk = false;
      mysqlError = error instanceof Error ? error.message : "未知 MySQL 错误";
    }

    const storage = await readStorage(options.generatedDir);
    const diskLevel = resolveDiskLevel(storage.diskOk, storage.usedPercent);
    const status: HealthLevel =
      !mysqlOk || diskLevel === "critical"
        ? "critical"
        : diskLevel === "warning"
          ? "warning"
          : "ok";
    const memory = process.memoryUsage();

    return {
      ok: status !== "critical",
      status,
      service: "ecom-ai-studio-api",
      checkedAt,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || "development",
      security: { secureCookie: options.secureCookie },
      process: {
        pid: process.pid,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal
      },
      mysql: {
        ok: mysqlOk,
        latencyMs: Date.now() - mysqlStart,
        users,
        activeSessions,
        pendingTasks,
        error: mysqlError
      },
      storage: {
        generatedDir: options.generatedDir,
        fileCount: storage.fileCount,
        generatedBytes: storage.generatedBytes,
        diskTotalBytes: storage.diskTotalBytes,
        diskFreeBytes: storage.diskFreeBytes,
        usedPercent: storage.usedPercent,
        level: diskLevel,
        available: storage.diskOk
      }
    };
  }

  return { check, checkPublic };
}

async function probeMysql(database: AppDatabase): Promise<boolean> {
  try {
    await database.pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function readStorage(generatedDir: string) {
  let fileCount = 0;
  let generatedBytes = 0;
  try {
    const entries = await readdir(generatedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const info = await stat(path.join(generatedDir, entry.name));
      fileCount += 1;
      generatedBytes += info.size;
    }
  } catch {
    fileCount = 0;
    generatedBytes = 0;
  }

  const disk = await readDiskUsage(generatedDir);
  return {
    fileCount,
    generatedBytes,
    diskTotalBytes: disk.diskTotalBytes,
    diskFreeBytes: disk.diskFreeBytes,
    usedPercent: disk.usedPercent,
    diskOk: disk.ok
  };
}

async function readDiskUsage(generatedDir: string) {
  try {
    const fsInfo = await statfs(generatedDir);
    const blockSize = Number(fsInfo.bsize);
    const total = Number(fsInfo.blocks) * blockSize;
    const free = Number(fsInfo.bavail) * blockSize;
    const usedPercent = total > 0
      ? Number((((total - free) / total) * 100).toFixed(2))
      : 0;
    return {
      ok: true,
      diskTotalBytes: total,
      diskFreeBytes: free,
      usedPercent
    };
  } catch {
    return {
      ok: false,
      diskTotalBytes: 0,
      diskFreeBytes: 0,
      usedPercent: 0
    };
  }
}

function resolveDiskLevel(diskOk: boolean, usedPercent: number): HealthLevel {
  if (!diskOk) return "critical";
  const warning = readThreshold(process.env.HEALTH_DISK_WARNING_PERCENT, 85);
  const critical = readThreshold(process.env.HEALTH_DISK_CRITICAL_PERCENT, 95);
  return usedPercent >= critical
    ? "critical"
    : usedPercent >= warning
      ? "warning"
      : "ok";
}

function readThreshold(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(100, Math.max(1, numeric))
    : fallback;
}

export type HealthService = ReturnType<typeof createHealthService>;
