import { Router, type RequestHandler, type Response } from "express";
import { ZodError } from "zod";
import {
  AuthError,
  type AuthService,
  type GenerationReservation,
  type UsageRecordInput
} from "../auth.js";
import { validateModelSize } from "../models.js";
import { calculateGenerationCreditCost } from "../pricing.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import { generateImage, getImageTask } from "../router.js";
import type { ProviderId } from "../types.js";
import { ProviderHttpError } from "../utils/http.js";
import { generateSchema } from "../validation.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { readRouteParam, sendAuthError } from "../utils/express.js";

export function createGenerationRouter(options: {
  authService: AuthService;
  modelSettingsService: ModelSettingsService;
  requireAuth: RequestHandler;
}): Router {
  const { authService, modelSettingsService, requireAuth } = options;
  const router = Router();

  router.post("/api/images/generate", requireAuth, async (request, response) => {
    const user = getAuthenticatedUser(request);
    let usageInput = buildUsageInputFromRawRequest(request.body, user.id);
    let reservation: GenerationReservation | undefined;

    try {
      const input = generateSchema.parse(request.body);
      const runtimeModel = modelSettingsService.get(input.provider, input.model);
      const model = runtimeModel?.capability;
      usageInput = {
        ...usageInput,
        provider: input.provider,
        model: input.model,
        operation: input.images.length > 0 ? "image-edit" : "text-to-image",
        size: input.size,
        imageCount: input.count
      };

      if (!model || !runtimeModel) return await rejectGeneration(authService, response, usageInput, "MODEL_NOT_FOUND", "模型不存在或尚未注册");
      if (!runtimeModel.enabled) return await rejectGeneration(authService, response, usageInput, "MODEL_DISABLED", "该模型已由站长暂停使用");
      if (model.provider !== input.provider) return await rejectGeneration(authService, response, usageInput, "MODEL_PROVIDER_MISMATCH", "模型与 API 服务商不匹配");
      if (!model.configured) return await rejectGeneration(authService, response, usageInput, "PROVIDER_NOT_CONFIGURED", `${model.providerName} 尚未配置 API Key`);
      if (input.images.length > model.maxReferenceImages) return await rejectGeneration(authService, response, usageInput, "TOO_MANY_IMAGES", `该模型最多支持 ${model.maxReferenceImages} 张参考图`);
      if (input.count > model.maxOutputImages) return await rejectGeneration(authService, response, usageInput, "TOO_MANY_OUTPUTS", `该模型单次最多生成 ${model.maxOutputImages} 张图片`);

      const sizeError = validateModelSize(model, input.size);
      if (sizeError) return await rejectGeneration(authService, response, usageInput, "INVALID_SIZE", sizeError);

      reservation = await authService.reserveGenerationCredits(
        user.id,
        calculateGenerationCreditCost(runtimeModel.points, input.count),
        model.providerName,
        model.name
      );

      const result = await generateImage(input);
      const isPending = result.status === "pending" || result.status === "processing";
      if (isPending) {
        await safeRecordUsage(authService, {
          ...usageInput,
          imageCount: input.count,
          status: "submitted",
          durationMs: result.durationMs,
          cost: result.cost,
          requestId: result.requestId || result.taskId,
          operationId: reservation.operationId,
          pointsCost: reservation.pointsCost
        });
        return response.json({ success: true, result, credits: reservation.balance, pointsCost: reservation.pointsCost });
      }

      const actualImageCount = result.images.length;
      if (actualImageCount < 1) throw new Error("服务端未返回生成图片");
      const settlement = await authService.settleGenerationCredits(
        user.id,
        reservation.operationId,
        calculateGenerationCreditCost(runtimeModel.points, actualImageCount),
        "按实际成功生成图片数量结算"
      );
      await safeRecordUsage(authService, {
        ...usageInput,
        imageCount: actualImageCount,
        status: "success",
        durationMs: result.durationMs,
        cost: result.cost,
        requestId: result.requestId || result.taskId,
        operationId: reservation.operationId,
        pointsCost: settlement.pointsCost,
        pointsRefunded: settlement.refunded
      });
      return response.json({ success: true, result, credits: settlement.balance, pointsCost: settlement.pointsCost, refundAmount: settlement.refundAmount });
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

      await safeRecordUsage(authService, {
        ...usageInput,
        status: "failed",
        operationId: reservation?.operationId,
        pointsCost: reservation?.pointsCost,
        pointsRefunded: refunded,
        error: errorMessage
      });

      if (error instanceof AuthError) return response.status(error.status).json({ error: { code: error.code, message: error.message }, credits: balance });
      if (error instanceof ZodError) {
        return response.status(400).json({ error: { code: "INVALID_REQUEST", message: error.issues[0]?.message || "请求参数不正确", issues: error.issues }, credits: balance });
      }
      if (error instanceof ProviderHttpError) {
        console.error("Provider error", error.details);
        return response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({ error: { code: "PROVIDER_ERROR", message: error.message }, credits: balance, refunded });
      }

      console.error(error);
      return response.status(500).json({ error: { code: "INTERNAL_ERROR", message: errorMessage || "生成失败，请稍后重试" }, credits: balance, refunded });
    }
  });

  router.get("/api/images/tasks/:provider/:taskId", requireAuth, async (request, response) => {
    const user = getAuthenticatedUser(request);
    try {
      const provider = readRouteParam(request.params.provider);
      const taskId = readRouteParam(request.params.taskId);
      const validProviders = new Set<ProviderId>(["lingke"]);
      if (!provider || !validProviders.has(provider as ProviderId)) return response.status(400).json({ error: { code: "INVALID_PROVIDER", message: "该厂商不支持异步任务查询" } });
      if (!taskId) return response.status(400).json({ error: { code: "INVALID_TASK_ID", message: "缺少 task_id" } });

      const usage = await authService.getUsageRecordByRequestId(user.id, taskId);
      if (!usage || usage.provider !== provider) return response.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "生成任务不存在" } });

      const result = await getImageTask(provider as ProviderId, taskId, usage.model);
      let credits = user.credits;
      let pointsCost = usage.pointsCost || 0;
      let refundAmount = 0;
      if (result.status === "completed" || result.status === "failed") {
        const successful = result.status === "completed" && result.images.length > 0;
        const finalized = await authService.finalizeAsyncUsage(user.id, taskId, {
          status: successful ? "success" : "failed",
          imageCount: result.images.length,
          actualPointsCost: successful
            ? calculateGenerationCreditCost(
                usage.imageCount > 0 ? (usage.pointsCost || 0) / usage.imageCount : (modelSettingsService.get(provider, usage.model)?.points || 0),
                result.images.length
              )
            : 0,
          durationMs: result.durationMs,
          cost: result.cost,
          error: successful ? undefined : result.error || "异步任务未返回图片"
        });
        credits = finalized.balance;
        pointsCost = finalized.pointsCost;
        refundAmount = finalized.refundAmount;
      }
      return response.json({ success: true, result, credits, pointsCost, refundAmount });
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        console.error("Provider task error", error.details);
        return response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({ error: { code: "PROVIDER_ERROR", message: error.message } });
      }
      if (error instanceof AuthError) return sendAuthError(response, error, "任务查询失败");
      console.error(error);
      return response.status(500).json({ error: { code: "TASK_QUERY_ERROR", message: error instanceof Error ? error.message : "任务查询失败" } });
    }
  });

  return router;
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

async function safeRecordUsage(authService: AuthService, input: UsageRecordInput): Promise<void> {
  try {
    await authService.recordUsage(input);
  } catch (error) {
    console.error("Usage record error", error);
  }
}

async function rejectGeneration(
  authService: AuthService,
  response: Response,
  usageInput: Omit<UsageRecordInput, "status">,
  code: string,
  message: string
): Promise<Response> {
  await safeRecordUsage(authService, { ...usageInput, status: "failed", error: message });
  return response.status(400).json({ error: { code, message } });
}
