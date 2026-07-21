import { Router, type Request, type RequestHandler } from "express";
import type { AuthService } from "../auth.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import type { AuditLogService } from "../services/audit-log.js";
import type { AdminQueryService } from "../services/admin-query.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { readRouteParam, sendAuthError } from "../utils/express.js";

export function createAdminRouter(options: {
  authService: AuthService;
  modelSettingsService: ModelSettingsService;
  auditLogService: AuditLogService;
  adminQueryService: AdminQueryService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}): Router {
  const { authService, modelSettingsService, auditLogService, adminQueryService, requireAuth, requireAdmin } = options;
  const router = Router();
  const protectedAdmin = [requireAuth, requireAdmin] as const;

  router.get("/api/admin/dashboard", ...protectedAdmin, async (_request, response) => {
    try { return response.json(await adminQueryService.dashboard()); }
    catch (error) { return sendAuthError(response, error, "读取站长看板失败"); }
  });

  router.get("/api/admin/users", ...protectedAdmin, async (request, response) => {
    try {
      const result = await adminQueryService.listUsers({ ...readPage(request), search: readText(request.query.search, 80), status: readText(request.query.status, 20) });
      return response.json({ users: result.items, pagination: result.pagination });
    } catch (error) { return sendAuthError(response, error, "读取用户列表失败"); }
  });

  router.patch("/api/admin/users/:id", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID");
      if (!userId) return;
      const actor = getAuthenticatedUser(request);
      const body = request.body as { username?: unknown; status?: unknown };
      const user = await authService.updateUser(userId, { username: body?.username, status: body?.status }, actor.id);
      await auditLogService.safeRecord({ actor, action: "user.update", targetType: "user", targetId: userId, summary: `更新用户 ${user.username}`, details: body, context: auditContext(request) });
      return response.json({ success: true, user });
    } catch (error) { return sendAuthError(response, error, "更新用户失败"); }
  });

  router.post("/api/admin/users/:id/logout", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID");
      if (!userId) return;
      const actor = getAuthenticatedUser(request);
      await authService.forceLogout(userId, actor.id);
      await auditLogService.safeRecord({ actor, action: "user.force_logout", targetType: "user", targetId: userId, summary: "强制退出用户全部会话", context: auditContext(request) });
      return response.json({ success: true });
    } catch (error) { return sendAuthError(response, error, "强制退出失败"); }
  });

  router.get("/api/admin/users/:id/logins", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID"); if (!userId) return;
      const result = await adminQueryService.listUserLogins(userId, readPage(request));
      return response.json({ records: result.items, pagination: result.pagination });
    } catch (error) { return sendAuthError(response, error, "读取登录记录失败"); }
  });

  router.get("/api/admin/users/:id/usage", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID"); if (!userId) return;
      const result = await adminQueryService.listUserUsage(userId, readPage(request));
      return response.json({ records: result.items, pagination: result.pagination });
    } catch (error) { return sendAuthError(response, error, "读取使用记录失败"); }
  });

  router.get("/api/admin/users/:id/credits", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID"); if (!userId) return;
      const result = await adminQueryService.listUserCredits(userId, readPage(request));
      return response.json({ records: result.items, pagination: result.pagination });
    } catch (error) { return sendAuthError(response, error, "读取积分明细失败"); }
  });

  router.post("/api/admin/users/:id/credits", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID"); if (!userId) return;
      const actor = getAuthenticatedUser(request);
      const body = request.body as { amount?: unknown; note?: unknown };
      const result = await authService.adjustCredits(userId, body?.amount, body?.note, actor.id);
      await auditLogService.safeRecord({ actor, action: "credit.adjust", targetType: "user", targetId: userId, summary: `调整 ${result.user.username} 积分`, details: { amount: body?.amount, note: body?.note, balance: result.user.credits }, context: auditContext(request) });
      return response.json({ success: true, user: result.user, transaction: result.transaction });
    } catch (error) { return sendAuthError(response, error, "调整用户积分失败"); }
  });

  router.get("/api/admin/cards", ...protectedAdmin, async (request, response) => {
    try {
      const result = await adminQueryService.listCards({ ...readPage(request), search: readText(request.query.search, 80), status: readText(request.query.status, 20) });
      return response.json({ cards: result.items, pagination: result.pagination });
    } catch (error) { return sendAuthError(response, error, "读取卡密列表失败"); }
  });

  router.post("/api/admin/cards", ...protectedAdmin, async (request, response) => {
    try {
      const actor = getAuthenticatedUser(request);
      const body = request.body as { points?: unknown; quantity?: unknown };
      const cards = await authService.generateRechargeCards(body?.points, body?.quantity, actor.id);
      await auditLogService.safeRecord({ actor, action: "card.generate", targetType: "recharge_card", summary: `生成 ${cards.length} 张充值卡密`, details: { points: body?.points, quantity: cards.length }, context: auditContext(request) });
      return response.status(201).json({ success: true, cards });
    } catch (error) { return sendAuthError(response, error, "生成卡密失败"); }
  });

  router.delete("/api/admin/cards/:id", ...protectedAdmin, async (request, response) => {
    try {
      const cardId = requiredId(request.params.id, response, "INVALID_CARD_ID", "缺少卡密 ID"); if (!cardId) return;
      const actor = getAuthenticatedUser(request);
      await authService.deleteUnusedRechargeCard(cardId, actor.id);
      await auditLogService.safeRecord({ actor, action: "card.delete", targetType: "recharge_card", targetId: cardId, summary: "删除未使用卡密", context: auditContext(request) });
      return response.json({ success: true });
    } catch (error) { return sendAuthError(response, error, "删除卡密失败"); }
  });

  router.get("/api/admin/models", ...protectedAdmin, (_request, response) => {
    response.json({ models: modelSettingsService.listAll().map((item) => ({
      provider: item.provider, model: item.model, name: item.name, providerName: item.providerName,
      enabled: item.enabled, points: item.points, configured: item.configured,
      description: item.capability.description, asynchronous: Boolean(item.capability.asynchronous),
      maxOutputImages: item.capability.maxOutputImages, updatedAt: item.updatedAt
    })) });
  });

  router.patch("/api/admin/models/:provider/:model", ...protectedAdmin, async (request, response) => {
    try {
      const provider = requiredId(request.params.provider, response, "INVALID_PROVIDER", "缺少服务商"); if (!provider) return;
      const modelId = requiredId(request.params.model, response, "INVALID_MODEL", "缺少模型 ID"); if (!modelId) return;
      const actor = getAuthenticatedUser(request);
      const body = request.body as { enabled?: unknown; points?: unknown };
      const model = await modelSettingsService.update(provider, modelId, body, actor.id);
      await auditLogService.safeRecord({ actor, action: "model.update", targetType: "model", targetId: `${provider}:${modelId}`, summary: `更新模型 ${model.name}`, details: { enabled: model.enabled, points: model.points }, context: auditContext(request) });
      return response.json({ success: true, model: { provider: model.provider, model: model.model, name: model.name, providerName: model.providerName, enabled: model.enabled, points: model.points, configured: model.configured, description: model.capability.description, asynchronous: Boolean(model.capability.asynchronous), maxOutputImages: model.capability.maxOutputImages, updatedAt: model.updatedAt } });
    } catch (error) { return sendAuthError(response, error, "更新模型设置失败"); }
  });

  router.get("/api/admin/audit", ...protectedAdmin, async (request, response) => {
    try {
      const result = await adminQueryService.listAudit({ ...readPage(request), search: readText(request.query.search, 80), action: readText(request.query.action, 80) });
      return response.json({ records: result.items, pagination: result.pagination });
    } catch (error) { return sendAuthError(response, error, "读取操作审计失败"); }
  });

  return router;
}

function readPage(request: Request) {
  const page = boundedInt(request.query.page, 1, 1, 100_000);
  const pageSize = boundedInt(request.query.pageSize, 20, 5, 100);
  return { page, pageSize };
}
function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
function readText(value: unknown, max: number) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined; }
function requiredId(value: string | string[] | undefined, response: import("express").Response, code: string, message: string) {
  const id = readRouteParam(value);
  if (!id) { response.status(400).json({ error: { code, message } }); return undefined; }
  return id;
}
function auditContext(request: Request) { return { clientIp: request.ip, userAgent: request.get("user-agent") }; }
