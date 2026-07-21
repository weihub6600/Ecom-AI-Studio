import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RowDataPacket } from "mysql2/promise";
import { createAppDatabase } from "./database.js";
import { migrateLegacyJsonData } from "./legacy-migration.js";
import { createModelSettingsService } from "../services/model-settings.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const dataDir = path.resolve(projectRoot, process.env.IMAGE_STORAGE_DIR || "data");

const database = await createAppDatabase();
try {
  const migration = await migrateLegacyJsonData(database, dataDir);
  const modelSettings = createModelSettingsService(database);
  await modelSettings.initialize();
  const [userRows] = await database.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM app_users");
  const [historyRows] = await database.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM app_history_records");
  const [modelRows] = await database.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM app_model_settings");
  console.log(migration.message);
  console.log(`MySQL 已连接：${database.storageLabel}`);
  console.log(`当前数据：用户 ${Number(userRows[0]?.total || 0)} 个，历史 ${Number(historyRows[0]?.total || 0)} 条，模型设置 ${Number(modelRows[0]?.total || 0)} 条`);
} finally {
  await database.close();
}
