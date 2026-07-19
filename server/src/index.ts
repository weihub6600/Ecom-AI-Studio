import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { getModels, findModel } from "./models.js";
import { generateImage, getImageTask } from "./router.js";
import { generateSchema } from "./validation.js";
import { ProviderHttpError } from "./utils/http.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
dotenv.config({ path: path.resolve(currentDir, "../../.env") });

const app = express();
const port = Number(process.env.PORT || 8787);

app.disable("x-powered-by");
app.use(express.json({ limit: "120mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "ecom-ai-studio-api", time: new Date().toISOString() });
});

app.get("/api/models", (_request, response) => {
  response.json({ models: getModels() });
});

app.post("/api/images/generate", async (request, response) => {
  try {
    const input = generateSchema.parse(request.body);
    const model = findModel(input.model);

    if (!model) {
      return response.status(400).json({ error: { code: "MODEL_NOT_FOUND", message: "模型不存在或尚未注册" } });
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
    const validProviders = new Set(["lingke"]);

    if (!provider || !validProviders.has(provider)) {
      return response.status(400).json({ error: { code: "INVALID_PROVIDER", message: "任务厂商不正确" } });
    }
    if (!taskId) {
      return response.status(400).json({ error: { code: "INVALID_TASK_ID", message: "缺少 task_id" } });
    }

    const result = await getImageTask(taskId, model);
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
});
