import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { getModels, findModel, validateModelSize } from "./models.js";
import { createHistoryService, HistoryValidationError, parseHistorySaveInput } from "./history.js";
import { generateImage, getImageTask } from "./router.js";
import type { ProviderId } from "./types.js";
import { generateSchema } from "./validation.js";
import { ProviderHttpError } from "./utils/http.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
dotenv.config({ path: path.resolve(currentDir, "../../.env") });

const app = express();
const port = Number(process.env.PORT || 8787);
const projectRoot = path.resolve(currentDir, "../..");
const historyService = createHistoryService({
  dataDir: path.resolve(projectRoot, process.env.IMAGE_STORAGE_DIR || "data"),
  maxRecords: Number(process.env.IMAGE_HISTORY_LIMIT || 100),
  maxImageBytes: Number(process.env.IMAGE_MAX_DOWNLOAD_BYTES || 41_943_040),
  downloadTimeoutMs: Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS || 120_000)
});
await historyService.initialize();

app.disable("x-powered-by");
app.use(express.json({ limit: "120mb" }));
app.use("/generated", express.static(historyService.generatedDir, { dotfiles: "deny", fallthrough: false, maxAge: "30d" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "ecom-ai-studio-api", time: new Date().toISOString() });
});

app.get("/api/models", (_request, response) => {
  response.json({ models: getModels() });
});

app.get("/api/history", async (request, response) => {
  try {
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 20;
    const history = await historyService.list(limit);
    return response.json({ history });
  } catch (error) {
    console.error("History list error", error);
    return response.status(500).json({ error: { code: "HISTORY_LIST_ERROR", message: "读取服务器生成历史失败" } });
  }
});

app.post("/api/history", async (request, response) => {
  try {
    const input = parseHistorySaveInput(request.body);
    const record = await historyService.save(input);
    return response.status(201).json({ success: true, record });
  } catch (error) {
    if (error instanceof HistoryValidationError) {
      return response.status(400).json({ error: { code: "INVALID_HISTORY_REQUEST", message: error.message } });
    }
    console.error("History save error", error);
    return response.status(502).json({
      error: { code: "HISTORY_SAVE_ERROR", message: error instanceof Error ? error.message : "图片保存到服务器失败" }
    });
  }
});

app.delete("/api/history/:id", async (request, response) => {
  try {
    const removed = await historyService.remove(request.params.id);
    if (!removed) return response.status(404).json({ error: { code: "HISTORY_NOT_FOUND", message: "历史记录不存在" } });
    return response.json({ success: true });
  } catch (error) {
    console.error("History delete error", error);
    return response.status(500).json({ error: { code: "HISTORY_DELETE_ERROR", message: "删除服务器历史失败" } });
  }
});

app.delete("/api/history", async (_request, response) => {
  try {
    await historyService.clear();
    return response.json({ success: true });
  } catch (error) {
    console.error("History clear error", error);
    return response.status(500).json({ error: { code: "HISTORY_CLEAR_ERROR", message: "清空服务器历史失败" } });
  }
});

app.post("/api/images/generate", async (request, response) => {
  try {
    const input = generateSchema.parse(request.body);
    const model = findModel(input.model);

    if (!model) {
      return response.status(400).json({ error: { code: "MODEL_NOT_FOUND", message: "模型不存在或尚未注册" } });
    }
    if (model.provider !== input.provider) {
      return response.status(400).json({ error: { code: "MODEL_PROVIDER_MISMATCH", message: "模型与 API 服务商不匹配" } });
    }
    if (!model.configured) {
      return response.status(400).json({ error: { code: "PROVIDER_NOT_CONFIGURED", message: `${model.providerName} 尚未配置 API Key` } });
    }
    if (input.images.length > model.maxReferenceImages) {
      return response.status(400).json({ error: { code: "TOO_MANY_IMAGES", message: `该模型最多支持 ${model.maxReferenceImages} 张参考图` } });
    }
    if (input.count > model.maxOutputImages) {
      return response.status(400).json({ error: { code: "TOO_MANY_OUTPUTS", message: `该模型单次最多生成 ${model.maxOutputImages} 张图片` } });
    }

    const sizeError = validateModelSize(model, input.size);
    if (sizeError) {
      return response.status(400).json({ error: { code: "INVALID_SIZE", message: sizeError } });
    }

    const result = await generateImage(input);
    return response.json({ success: true, result });
  } catch (error) {
    if (error instanceof ZodError) {
      return response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: error.issues[0]?.message || "请求参数不正确",
          issues: error.issues
        }
      });
    }
    if (error instanceof ProviderHttpError) {
      console.error("Provider error", error.details);
      return response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
        error: { code: "PROVIDER_ERROR", message: error.message }
      });
    }

    console.error(error);
    return response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "生成失败，请稍后重试" }
    });
  }
});

app.get("/api/images/tasks/:provider/:taskId", async (request, response) => {
  try {
    const provider = request.params.provider;
    const taskId = request.params.taskId;
    const model = typeof request.query.model === "string" ? request.query.model : undefined;
    const validProviders = new Set<ProviderId>(["lingke"]);

    if (!provider || !validProviders.has(provider as ProviderId)) {
      return response.status(400).json({ error: { code: "INVALID_PROVIDER", message: "该厂商不支持异步任务查询" } });
    }
    if (!taskId) {
      return response.status(400).json({ error: { code: "INVALID_TASK_ID", message: "缺少 task_id" } });
    }

    const result = await getImageTask(provider as ProviderId, taskId, model);
    return response.json({ success: true, result });
  } catch (error) {
    if (error instanceof ProviderHttpError) {
      console.error("Provider task error", error.details);
      return response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
        error: { code: "PROVIDER_ERROR", message: error.message }
      });
    }

    console.error(error);
    return response.status(500).json({
      error: { code: "TASK_QUERY_ERROR", message: error instanceof Error ? error.message : "任务查询失败" }
    });
  }
});

const webDist = path.resolve(currentDir, "../../web/dist");

app.use(express.static(webDist));
app.get("/{*path}", (request, response, next) => {
  if (request.path.startsWith("/api/")) return next();
  response.sendFile(path.join(webDist, "index.html"), (error) => {
    if (error) next();
  });
});

app.listen(port, () => {
  console.log(`Ecom AI Studio API: http://localhost:${port}`);
  console.log(`Generated images: ${historyService.generatedDir}`);
});
