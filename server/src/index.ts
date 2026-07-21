import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import {
  AuthError,
  createAuthService,
  createClearSessionCookie,
  createSessionCookie,
  readAuthToken,
  type GenerationReservation,
  type PublicUser,
  type UsageRecordInput
} from "./auth.js";
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
const dataDir = path.resolve(projectRoot, process.env.IMAGE_STORAGE_DIR || "data");
const secureAuthCookie = process.env.AUTH_COOKIE_SECURE === "true";

const historyService = createHistoryService({
  dataDir,
  maxRecords: Number(process.env.IMAGE_HISTORY_LIMIT || 0),
  maxImageBytes: Number(process.env.IMAGE_MAX_DOWNLOAD_BYTES || 41_943_040),
  downloadTimeoutMs: Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS || 120_000)
});

const authService = createAuthService({
  dataDir,
  sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS || 2_592_000),
  adminUsername: process.env.ADMIN_USERNAME
});

await Promise.all([historyService.initialize(), authService.initialize()]);

app.disable("x-powered-by");
app.use(express.json({ limit: "120mb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  next();
});

interface AuthenticatedRequest extends Request {
  authUser?: PublicUser;
}

const requireAuth: RequestHandler = async (request, response, next) => {
  try {
    const token = readAuthToken(request.headers.cookie);
    const user = await authService.getUserByToken(token);
    if (!user) {
      return response.status(401).json({
        error: { code: "UNAUTHORIZED", message: "请先登录后再使用网站功能" }
      });
    }
    (request as AuthenticatedRequest).authUser = user;
    next();
  } catch (error) {
    console.error("Authentication error", error);
    return response.status(500).json({
      error: { code: "AUTH_ERROR", message: "登录状态验证失败" }
    });
  }
};

const requireAdmin: RequestHandler = (request, response, next) => {
  const user = (request as AuthenticatedRequest).authUser;
  if (!user || user.role !== "admin") {
    response.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "只有站长可以访问管理后台" } });
    return;
  }
  next();
};

const authRateLimit = createSimpleRateLimit({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "ecom-ai-studio-api", time: new Date().toISOString() });
});

app.get("/api/models", (_request, response) => {
  response.json({
    models: getModels().map((model) => ({
      ...model,
      creditCost: getModelCreditCost(model.provider, model.id)
    }))
  });
});

app.get("/api/auth/me", async (request, response) => {
  try {
    const token = readAuthToken(request.headers.cookie);
    const user = await authService.getUserByToken(token);
    if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED", message: "尚未登录" } });
    return response.json({ user });
  } catch (error) {
    console.error("Auth me error", error);
    return response.status(500).json({ error: { code: "AUTH_ERROR", message: "读取登录状态失败" } });
  }
});

app.post("/api/auth/register", authRateLimit, async (request, response) => {
  try {
    const body = request.body as { username?: unknown; password?: unknown };
    const result = await authService.register(body?.username, body?.password);
    if (result.token) {
      response.setHeader("Set-Cookie", createSessionCookie(result.token, authService.sessionTtlSeconds, secureAuthCookie));
    }
    return response.status(201).json({ success: true, user: result.user, pending: result.pending });
  } catch (error) {
    return sendAuthError(response, error, "注册失败");
  }
});

app.post("/api/auth/login", authRateLimit, async (request, response) => {
  try {
    const body = request.body as { username?: unknown; password?: unknown };
    const result = await authService.login(body?.username, body?.password, {
      clientIp: request.ip,
      userAgent: request.get("user-agent")
    });
    response.setHeader("Set-Cookie", createSessionCookie(result.token, authService.sessionTtlSeconds, secureAuthCookie));
    return response.json({ success: true, user: result.user });
  } catch (error) {
    return sendAuthError(response, error, "登录失败");
  }
});

app.post("/api/auth/logout", async (request, response) => {
  try {
    await authService.logout(readAuthToken(request.headers.cookie));
  } catch (error) {
    console.error("Logout error", error);
  }
  response.setHeader("Set-Cookie", createClearSessionCookie(secureAuthCookie));
  return response.json({ success: true });
});

// 普通用户个人后台：只允许读取自己的数据，不能修改自己的用户名。
app.get("/api/account/summary", requireAuth, async (request, response) => {
  const user = getAuthenticatedUser(request);
  return response.json({ user, prices: getCreditPriceList() });
});

app.get("/api/account/usage", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 200;
    const records = await authService.listUsageRecords(user.id, limit);
    return response.json({ records });
  } catch (error) {
    return sendAuthError(response, error, "读取 AI 使用记录失败");
  }
});

app.get("/api/account/credits", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 300;
    const records = await authService.listCreditTransactions(user.id, limit);
    return response.json({ records });
  } catch (error) {
    return sendAuthError(response, error, "读取积分明细失败");
  }
});

app.post("/api/account/redeem", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    const body = request.body as { code?: unknown };
    const result = await authService.redeemRechargeCard(user.id, body?.code);
    return response.json({ success: true, user: result.user, transaction: result.transaction });
  } catch (error) {
    return sendAuthError(response, error, "卡密充值失败");
  }
});

// 站长后台。
app.get("/api/admin/users", requireAuth, requireAdmin, async (_request, response) => {
  try {
    const users = await authService.listUsers();
    return response.json({ users });
  } catch (error) {
    return sendAuthError(response, error, "读取用户列表失败");
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const userId = readRouteParam(request.params.id);
    if (!userId) return response.status(400).json({ error: { code: "INVALID_USER_ID", message: "缺少用户 ID" } });
    const body = request.body as { username?: unknown; status?: unknown };
    const user = await authService.updateUser(userId, { username: body?.username, status: body?.status }, actor.id);
    return response.json({ success: true, user });
  } catch (error) {
    return sendAuthError(response, error, "更新用户失败");
  }
});

app.post("/api/admin/users/:id/logout", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const userId = readRouteParam(request.params.id);
    if (!userId) return response.status(400).json({ error: { code: "INVALID_USER_ID", message: "缺少用户 ID" } });
    await authService.forceLogout(userId, actor.id);
    return response.json({ success: true });
  } catch (error) {
    return sendAuthError(response, error, "强制退出失败");
  }
});

app.get("/api/admin/users/:id/logins", requireAuth, requireAdmin, async (request, response) => {
  try {
    const userId = readRouteParam(request.params.id);
    if (!userId) return response.status(400).json({ error: { code: "INVALID_USER_ID", message: "缺少用户 ID" } });
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 200;
    const records = await authService.listLoginRecords(userId, limit);
    return response.json({ records });
  } catch (error) {
    return sendAuthError(response, error, "读取登录记录失败");
  }
});

app.get("/api/admin/users/:id/usage", requireAuth, requireAdmin, async (request, response) => {
  try {
    const userId = readRouteParam(request.params.id);
    if (!userId) return response.status(400).json({ error: { code: "INVALID_USER_ID", message: "缺少用户 ID" } });
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 200;
    const records = await authService.listUsageRecords(userId, limit);
    return response.json({ records });
  } catch (error) {
    return sendAuthError(response, error, "读取使用记录失败");
  }
});

app.get("/api/admin/users/:id/credits", requireAuth, requireAdmin, async (request, response) => {
  try {
    const userId = readRouteParam(request.params.id);
    if (!userId) return response.status(400).json({ error: { code: "INVALID_USER_ID", message: "缺少用户 ID" } });
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 300;
    const records = await authService.listCreditTransactions(userId, limit);
    return response.json({ records });
  } catch (error) {
    return sendAuthError(response, error, "读取积分明细失败");
  }
});

app.post("/api/admin/users/:id/credits", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const userId = readRouteParam(request.params.id);
    if (!userId) return response.status(400).json({ error: { code: "INVALID_USER_ID", message: "缺少用户 ID" } });
    const body = request.body as { amount?: unknown; note?: unknown };
    const result = await authService.adjustCredits(userId, body?.amount, body?.note, actor.id);
    return response.json({ success: true, user: result.user, transaction: result.transaction });
  } catch (error) {
    return sendAuthError(response, error, "调整用户积分失败");
  }
});

app.get("/api/admin/cards", requireAuth, requireAdmin, async (request, response) => {
  try {
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 300;
    const cards = await authService.listRechargeCards(limit);
    return response.json({ cards });
  } catch (error) {
    return sendAuthError(response, error, "读取卡密列表失败");
  }
});

app.post("/api/admin/cards", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const body = request.body as { points?: unknown; quantity?: unknown };
    const cards = await authService.generateRechargeCards(body?.points, body?.quantity, actor.id);
    return response.status(201).json({ success: true, cards });
  } catch (error) {
    return sendAuthError(response, error, "生成卡密失败");
  }
});

app.delete("/api/admin/cards/:id", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const cardId = readRouteParam(request.params.id);

    if (!cardId) {
      return response.status(400).json({
        error: {
          code: "INVALID_CARD_ID",
          message: "缺少卡密 ID"
        }
      });
    }

    await authService.deleteUnusedRechargeCard(cardId, actor.id);
    return response.json({ success: true });
  } catch (error) {
    return sendAuthError(response, error, "删除卡密失败");
  }
});

app.use("/generated", requireAuth, express.static(historyService.generatedDir, {
  dotfiles: "deny",
  fallthrough: false,
  maxAge: "30d"
}));

app.get("/api/history", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 20;
    const history = await historyService.list(limit, user.id);
    return response.json({ history });
  } catch (error) {
    console.error("History list error", error);
    return response.status(500).json({ error: { code: "HISTORY_LIST_ERROR", message: "读取生成历史失败" } });
  }
});

app.post("/api/history", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    const input = parseHistorySaveInput({ ...request.body, clientId: user.id });
    const record = await historyService.save(input, {
      clientIp: request.ip,
      userAgent: request.get("user-agent"),
      ownerUsername: user.username
    });
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

app.delete("/api/history/:id", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    const historyId = readRouteParam(request.params.id);
    if (!historyId) return response.status(400).json({ error: { code: "INVALID_HISTORY_ID", message: "缺少历史记录 ID" } });
    const removed = await historyService.remove(historyId, user.id);
    if (!removed) return response.status(404).json({ error: { code: "HISTORY_NOT_FOUND", message: "历史记录不存在" } });
    return response.json({ success: true });
  } catch (error) {
    console.error("History delete error", error);
    return response.status(500).json({ error: { code: "HISTORY_DELETE_ERROR", message: "删除历史记录失败" } });
  }
});

app.delete("/api/history", requireAuth, async (request, response) => {
  try {
    const user = getAuthenticatedUser(request);
    await historyService.clear(user.id);
    return response.json({ success: true });
  } catch (error) {
    console.error("History clear error", error);
    return response.status(500).json({ error: { code: "HISTORY_CLEAR_ERROR", message: "清空历史记录失败" } });
  }
});

app.post("/api/images/generate", requireAuth, async (request, response) => {
  const user = getAuthenticatedUser(request);
  let usageInput = buildUsageInputFromRawRequest(request.body, user.id);
  let reservation: GenerationReservation | undefined;

  try {
    const input = generateSchema.parse(request.body);
    const model = findModel(input.model);
    usageInput = {
      ...usageInput,
      provider: input.provider,
      model: input.model,
      operation: input.images.length > 0 ? "image-edit" : "text-to-image",
      size: input.size,
      imageCount: input.count
    };

    if (!model) return await rejectGeneration(response, usageInput, "MODEL_NOT_FOUND", "模型不存在或尚未注册");
    if (model.provider !== input.provider) return await rejectGeneration(response, usageInput, "MODEL_PROVIDER_MISMATCH", "模型与 API 服务商不匹配");
    if (!model.configured) return await rejectGeneration(response, usageInput, "PROVIDER_NOT_CONFIGURED", `${model.providerName} 尚未配置 API Key`);
    if (input.images.length > model.maxReferenceImages) return await rejectGeneration(response, usageInput, "TOO_MANY_IMAGES", `该模型最多支持 ${model.maxReferenceImages} 张参考图`);
    if (input.count > model.maxOutputImages) return await rejectGeneration(response, usageInput, "TOO_MANY_OUTPUTS", `该模型单次最多生成 ${model.maxOutputImages} 张图片`);

    const sizeError = validateModelSize(model, input.size);
    if (sizeError) return await rejectGeneration(response, usageInput, "INVALID_SIZE", sizeError);

    const pointsCost = Number((getModelCreditCost(model.provider, model.id) * input.count).toFixed(2));
    reservation = await authService.reserveGenerationCredits(user.id, pointsCost, model.providerName, model.name);

    const result = await generateImage(input);
    await safeRecordUsage({
      ...usageInput,
      imageCount: result.images.length || input.count,
      status: result.status === "pending" || result.status === "processing" ? "submitted" : "success",
      durationMs: result.durationMs,
      cost: result.cost,
      requestId: result.requestId || result.taskId,
      operationId: reservation.operationId,
      pointsCost: reservation.pointsCost
    });
    return response.json({
      success: true,
      result,
      credits: reservation.balance,
      pointsCost: reservation.pointsCost
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "生成失败";
    let balance = user.credits;
    let refunded = false;
    if (reservation) {
      try {
        const refund = await authService.refundGenerationCredits(user.id, reservation.operationId, errorMessage);
        balance = refund.balance;
        refunded = refund.refunded;
      } catch (refundError) {
        console.error("Generation credit refund error", refundError);
      }
    }

    await safeRecordUsage({
      ...usageInput,
      status: "failed",
      operationId: reservation?.operationId,
      pointsCost: reservation?.pointsCost,
      pointsRefunded: refunded,
      error: errorMessage
    });

    if (error instanceof AuthError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message }, credits: balance });
    }
    if (error instanceof ZodError) {
      return response.status(400).json({
        error: { code: "INVALID_REQUEST", message: error.issues[0]?.message || "请求参数不正确", issues: error.issues },
        credits: balance
      });
    }
    if (error instanceof ProviderHttpError) {
      console.error("Provider error", error.details);
      return response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
        error: { code: "PROVIDER_ERROR", message: error.message },
        credits: balance,
        refunded
      });
    }

    console.error(error);
    return response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: errorMessage || "生成失败，请稍后重试" },
      credits: balance,
      refunded
    });
  }
});

app.get("/api/images/tasks/:provider/:taskId", requireAuth, async (request, response) => {
  const user = getAuthenticatedUser(request);
  try {
    const provider = readRouteParam(request.params.provider);
    const taskId = readRouteParam(request.params.taskId);
    const model = typeof request.query.model === "string" ? request.query.model : undefined;
    const validProviders = new Set<ProviderId>(["lingke"]);

    if (!provider || !validProviders.has(provider as ProviderId)) {
      return response.status(400).json({ error: { code: "INVALID_PROVIDER", message: "该厂商不支持异步任务查询" } });
    }
    if (!taskId) return response.status(400).json({ error: { code: "INVALID_TASK_ID", message: "缺少 task_id" } });

    const result = await getImageTask(provider as ProviderId, taskId, model);
    let credits = user.credits;
    if (result.status === "completed" || result.status === "failed") {
      const finalized = await authService.finalizeAsyncUsage(user.id, taskId, {
        status: result.status === "completed" ? "success" : "failed",
        imageCount: result.images.length,
        durationMs: result.durationMs,
        cost: result.cost,
        error: result.error
      });
      credits = finalized.balance;
    }
    return response.json({ success: true, result, credits });
  } catch (error) {
    if (error instanceof ProviderHttpError) {
      console.error("Provider task error", error.details);
      return response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
        error: { code: "PROVIDER_ERROR", message: error.message }
      });
    }
    if (error instanceof AuthError) return sendAuthError(response, error, "任务查询失败");
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
  console.log(`Auth and credit data: ${authService.authFile}`);
  if (!process.env.ADMIN_USERNAME) console.warn("ADMIN_USERNAME 未配置，无法自动创建或识别站长账号");
});

function getModelCreditCost(provider: ProviderId, modelId: string): number {
  if (provider === "lingke") return 1.5;
  if (provider === "grsai") return modelId === "grsai-gpt-image-2-vip" ? 2 : 1;
  if (provider === "nanobanana") return modelId === "nanobanana-nano-banana-pro" ? 3 : 2;
  return 0;
}

function getCreditPriceList() {
  return [
    { provider: "grsai", model: "grsai-gpt-image-2", name: "GPT Image 2", points: 1 },
    { provider: "grsai", model: "grsai-gpt-image-2-vip", name: "GPT Image 2 VIP", points: 2 },
    { provider: "nanobanana", model: "nanobanana-nano-banana-pro", name: "Nano Banana Pro", points: 3 },
    { provider: "nanobanana", model: "nanobanana-nano-banana-2", name: "Nano Banana 2", points: 2 },
    { provider: "lingke", model: "gpt-image-2", name: "百嘉瑞AI · GPT Image 2", points: 1.5 }
  ];
}

function readRouteParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function getAuthenticatedUser(request: Request): PublicUser {
  const user = (request as AuthenticatedRequest).authUser;
  if (!user) throw new Error("Authenticated route is missing authUser");
  return user;
}

function sendAuthError(response: Response, error: unknown, fallbackMessage: string): Response {
  if (error instanceof AuthError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  console.error("Auth route error", error);
  return response.status(500).json({ error: { code: "AUTH_ERROR", message: fallbackMessage } });
}

function buildUsageInputFromRawRequest(value: unknown, userId: string): Omit<UsageRecordInput, "status"> {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const images = Array.isArray(body.images) ? body.images : [];
  return {
    userId,
    provider: typeof body.provider === "string" ? body.provider : "unknown",
    model: typeof body.model === "string" ? body.model : "unknown",
    operation: images.length > 0 ? "image-edit" : "text-to-image",
    size: typeof body.size === "string" ? body.size : "auto",
    prompt: typeof body.prompt === "string" ? body.prompt : undefined,
    imageCount: typeof body.count === "number" ? body.count : 0
  };
}

async function safeRecordUsage(input: UsageRecordInput): Promise<void> {
  try {
    await authService.recordUsage(input);
  } catch (error) {
    console.error("Usage record error", error);
  }
}

async function rejectGeneration(
  response: Response,
  usageInput: Omit<UsageRecordInput, "status">,
  code: string,
  message: string
): Promise<Response> {
  await safeRecordUsage({ ...usageInput, status: "failed", error: message });
  return response.status(400).json({ error: { code, message } });
}

function createSimpleRateLimit(options: { windowMs: number; maxAttempts: number }): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.maxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({
        error: { code: "TOO_MANY_AUTH_ATTEMPTS", message: "登录或注册尝试过于频繁，请稍后再试" }
      });
      return;
    }

    current.count += 1;
    if (buckets.size > 10_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    next();
  };
}
