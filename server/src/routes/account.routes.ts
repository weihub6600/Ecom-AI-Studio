import { Router } from "express";
import type { AuthService } from "../auth.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { readLimit, sendAuthError } from "../utils/express.js";

export function createAccountRouter(options: {
  authService: AuthService;
  modelSettingsService: ModelSettingsService;
  requireAuth: import("express").RequestHandler;
}): Router {
  const { authService, modelSettingsService, requireAuth } = options;
  const router = Router();

  router.get("/api/account/summary", requireAuth, (request, response) => {
    response.json({ user: getAuthenticatedUser(request), prices: modelSettingsService.getPriceList() });
  });

  router.get("/api/account/usage", requireAuth, async (request, response) => {
    try {
      return response.json({ records: await authService.listUsageRecords(getAuthenticatedUser(request).id, readLimit(request.query.limit, 200)) });
    } catch (error) { return sendAuthError(response, error, "读取 AI 使用记录失败"); }
  });

  router.get("/api/account/credits", requireAuth, async (request, response) => {
    try {
      return response.json({ records: await authService.listCreditTransactions(getAuthenticatedUser(request).id, readLimit(request.query.limit, 300)) });
    } catch (error) { return sendAuthError(response, error, "读取积分明细失败"); }
  });

  router.post("/api/account/redeem", requireAuth, async (request, response) => {
    try {
      const user = getAuthenticatedUser(request);
      const body = request.body as { code?: unknown };
      const result = await authService.redeemRechargeCard(user.id, body?.code);
      return response.json({ success: true, user: result.user, transaction: result.transaction });
    } catch (error) { return sendAuthError(response, error, "卡密充值失败"); }
  });

  return router;
}
