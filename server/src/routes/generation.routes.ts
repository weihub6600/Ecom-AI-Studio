import type { AppDatabase } from "../db/database.js";
import type {
  HistoryService
} from "../history.js";
import {
  Router,
  type RequestHandler,
  type Response
} from "express";
import { ZodError } from "zod";
import {
  AuthError,
  type AuthService,
  type GenerationReservation,
  type UsageRecordInput
} from "../auth.js";
import { validateModelSize } from "../models.js";
import {
  calculateGenerationCreditCost
} from "../pricing.js";
import type {
  ModelSettingsService
} from "../services/model-settings.js";
import type {
  CustomProviderService
} from "../services/custom-providers.js";
import {
  generateImage,
  getImageTask
} from "../router.js";
import type { ProviderId } from "../types.js";
import {
  ProviderHttpError
} from "../utils/http.js";
import { generateSchema } from "../validation.js";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import {
  createSimpleRateLimit
} from "../middleware/rate-limit.js";
import {
  createGenerationGuard
} from "../services/generation-guard.js";
import {
  createGenerationTask,
  findGenerationTaskByProviderTaskId,
  parseProviderProgress,
  updateGenerationTask
} from "../services/generation-tasks.js";
import {
  archiveGenerationResult
} from "../services/generation-result-archive.js";
import {
  readRouteParam,
  sendAuthError
} from "../utils/express.js";

export function createGenerationRouter(options: {
  database: AppDatabase;
  authService: AuthService;
  historyService: HistoryService;
  modelSettingsService: ModelSettingsService;
  customProviderService: CustomProviderService;
  batchWorkerSecret?: string;
  requireAuth: RequestHandler;
}): Router {
  const {
    database,
    authService,
    historyService,
    modelSettingsService,
    customProviderService,
    batchWorkerSecret,
    requireAuth
  } = options;

  const router = Router();

  const generationGuard = createGenerationGuard({
    maxConcurrent: readPositiveEnv(
      "GENERATION_MAX_CONCURRENT",
      4
    ),
    maxPerUser: readPositiveEnv(
      "GENERATION_MAX_PER_USER",
      1
    )
  });

  const generationRateLimit = createSimpleRateLimit({
    windowMs: readPositiveEnv(
      "GENERATION_RATE_WINDOW_MS",
      60_000
    ),
    maxAttempts: readPositiveEnv(
      "GENERATION_RATE_MAX_REQUESTS",
      8
    ),
    code: "GENERATION_RATE_LIMITED",
    message: "生图请求过于频繁，请稍后再试",
    keyGenerator: (request) => {
      try {
        return getAuthenticatedUser(request).id;
      }
      catch {
        return (
          request.ip ||
          request.socket.remoteAddress ||
          "unknown"
        );
      }
    }
  });


  const batchAwareRateLimit: RequestHandler =
    (request, response, next) => {
      if (
        batchWorkerSecret &&
        request.get("x-ecom-batch-worker") ===
          batchWorkerSecret
      ) {
        next();
        return;
      }

      generationRateLimit(
        request,
        response,
        next
      );
    };
  router.post(
    "/api/images/generate",
    requireAuth,
    batchAwareRateLimit,
    async (request, response) => {
      const user = getAuthenticatedUser(request);

      let usageInput =
        buildUsageInputFromRawRequest(
          request.body,
          user.id
        );

      let reservation:
        GenerationReservation | undefined;

      let taskRecordId: string | undefined;

      let releaseGeneration:
        (() => void) | undefined;

      try {
        const input =
          generateSchema.parse(request.body);

        const runtimeModel =
          modelSettingsService.get(
            input.provider,
            input.model
          ) ||
          customProviderService.getRuntimeModel(
            input.provider,
            input.model
          );

        const model =
          runtimeModel?.capability;

        usageInput = {
          ...usageInput,
          provider: input.provider,
          model: input.model,
          operation:
            input.images.length > 0
              ? "image-edit"
              : "text-to-image",
          size: input.size,
          imageCount: input.count
        };

        if (!model || !runtimeModel) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "MODEL_NOT_FOUND",
            "模型不存在或尚未注册"
          );
        }

        if (!runtimeModel.enabled) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "MODEL_DISABLED",
            "该模型已由站长暂停使用"
          );
        }

        if (model.provider !== input.provider) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "MODEL_PROVIDER_MISMATCH",
            "模型与 API 服务商不匹配"
          );
        }

        if (!model.configured) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "PROVIDER_NOT_CONFIGURED",
            `${model.providerName} 尚未配置 API Key`
          );
        }

        if (
          input.images.length >
          model.maxReferenceImages
        ) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "TOO_MANY_IMAGES",
            `该模型最多支持 ${model.maxReferenceImages} 张参考图`
          );
        }

        if (
          input.count >
          model.maxOutputImages
        ) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "TOO_MANY_OUTPUTS",
            `该模型单次最多生成 ${model.maxOutputImages} 张图片`
          );
        }

        const sizeError =
          validateModelSize(
            model,
            input.size
          );

        if (sizeError) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "INVALID_SIZE",
            sizeError
          );
        }

        releaseGeneration =
          generationGuard.acquire(user.id);

        reservation =
          await authService.reserveGenerationCredits(
            user.id,
            calculateGenerationCreditCost(
              runtimeModel.points,
              input.count
            ),
            model.providerName,
            model.name
          );

        taskRecordId =
          await createGenerationTask(
            database,
            {
              userId: user.id,
              batchItemId:
                readBatchItemId(request.body),
              provider: input.provider,
              model: input.model,
              operation: input.operation,
              size: input.size,
              prompt: input.prompt,
              requestedImageCount: input.count,
              operationId:
                reservation.operationId,
              reservedPoints:
                reservation.pointsCost,
              thumbnailDataUrl:
                readTaskThumbnail(request.body),
              requestSnapshot: {
                provider: input.provider,
                model: input.model,
                operation: input.operation,
                prompt: input.prompt,
                negativePrompt:
                  input.negativePrompt,
                size: input.size,
                count: input.count,
                seed: input.seed
              }
            }
          );

        await updateGenerationTask(
          database,
          taskRecordId,
          {
            status: "running",
            stage: "submitting",
            progress: 30,
            providerProgress:
              "正在提交模型",
            markStarted: true
          }
        );

        const result =
          customProviderService.hasProvider(input.provider)
            ? await customProviderService.generate(input)
            : await generateImage(input);

        const isPending =
          result.status === "pending" ||
          result.status === "processing";

        if (isPending) {
          await updateGenerationTask(
            database,
            taskRecordId,
            {
              status: "running",
              stage: "processing",
              progress:
                parseProviderProgress(
                  result.progress,
                  45
                ),
              providerTaskId:
                result.taskId ||
                result.requestId,
              providerProgress:
                result.progress ||
                "AI 正在生成画面"
            }
          );

          await safeRecordUsage(
            authService,
            {
              ...usageInput,
              imageCount: input.count,
              status: "submitted",
              durationMs: result.durationMs,
              cost: result.cost,
              requestId:
                result.taskId ||
                result.requestId,
              operationId:
                reservation.operationId,
              pointsCost:
                reservation.pointsCost
            }
          );

          return response.json({
            success: true,
            result,
            credits: reservation.balance,
            pointsCost:
              reservation.pointsCost,
            taskRecordId
          });
        }

        const actualImageCount =
          result.images.length;

        if (actualImageCount < 1) {
          throw new Error(
            "服务端未返回生成图片"
          );
        }

        const historyRecord =
          await archiveGenerationResult(
            {
              database,
              historyService,
              taskId:
                taskRecordId,
              userId: user.id,
              username:
                user.username,
              provider:
                input.provider,
              providerName:
                model.providerName,
              model:
                input.model,
              prompt:
                input.prompt,
              operation:
                input.operation,
              size:
                input.size,
              result,
              clientIp:
                request.ip,
              userAgent:
                request.get(
                  "user-agent"
                )
            }
          );

        await updateGenerationTask(
          database,
          taskRecordId,
          {
            status: "running",
            stage: "settling",
            progress: 98,
            historyId:
              historyRecord.id,
            providerProgress:
              "正在结算积分"
          }
        );

        const settlement =
          await authService.settleGenerationCredits(
            user.id,
            reservation.operationId,
            calculateGenerationCreditCost(
              runtimeModel.points,
              actualImageCount
            ),
            "按实际成功生成图片数量结算"
          );

        await updateGenerationTask(
          database,
          taskRecordId,
          {
            status: "success",
            stage: "completed",
            progress: 100,
            actualImageCount,
            providerTaskId:
              result.taskId ||
              result.requestId,
            providerProgress:
              result.progress ||
              "100%",
            historyId:
              historyRecord.id,
            actualPoints:
              settlement.pointsCost,
            refundedPoints:
              settlement.refundAmount,
            markCompleted: true
          }
        );

        await safeRecordUsage(
          authService,
          {
            ...usageInput,
            imageCount: actualImageCount,
            status: "success",
            durationMs: result.durationMs,
            cost: result.cost,
            requestId:
              result.requestId ||
              result.taskId,
            operationId:
              reservation.operationId,
            pointsCost:
              settlement.pointsCost,
            pointsRefunded:
              settlement.refunded
          }
        );

        return response.json({
          success: true,
          result,
          credits: settlement.balance,
          pointsCost:
            settlement.pointsCost,
          refundAmount:
            settlement.refundAmount,
          taskRecordId,
          historyRecord
        });
      }
      catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "生成失败";

        let balance = user.credits;
        let refunded = false;

        if (reservation) {
          try {
            const refund =
              await authService.refundGenerationCredits(
                user.id,
                reservation.operationId,
                errorMessage
              );

            balance = refund.balance;
            refunded = refund.refunded;
          }
          catch (refundError) {
            console.error(
              "生图积分退款失败",
              refundError
            );
          }
        }

        await updateGenerationTask(
          database,
          taskRecordId,
          {
            status: "failed",
            stage:
              refunded
                ? "refunded"
                : "failed",
            progress: 100,
            actualImageCount: 0,
            actualPoints: 0,
            refundedPoints:
              refunded
                ? reservation?.pointsCost || 0
                : 0,
            errorCode:
              generationErrorCode(error),
            errorMessage,
            providerProgress:
              refunded
                ? "生成失败，积分已退回"
                : "生成失败",
            markCompleted: true
          }
        ).catch((taskError) => {
          console.error(
            "更新任务失败状态失败",
            taskError
          );
        });

        await safeRecordUsage(
          authService,
          {
            ...usageInput,
            status: "failed",
            operationId:
              reservation?.operationId,
            pointsCost:
              reservation?.pointsCost,
            pointsRefunded: refunded,
            error: errorMessage
          }
        );

        if (error instanceof AuthError) {
          return response
            .status(error.status)
            .json({
              error: {
                code: error.code,
                message: error.message
              },
              credits: balance
            });
        }

        if (error instanceof ZodError) {
          return response
            .status(400)
            .json({
              error: {
                code: "INVALID_REQUEST",
                message:
                  error.issues[0]?.message ||
                  "请求参数不正确",
                issues: error.issues
              },
              credits: balance
            });
        }

        if (error instanceof ProviderHttpError) {
          console.error(
            "模型服务商接口错误",
            error.details
          );

          return response
            .status(
              error.status >= 400 &&
              error.status < 600
                ? error.status
                : 502
            )
            .json({
              error: {
                code: "PROVIDER_ERROR",
                message: error.message
              },
              credits: balance,
              refunded
            });
        }

        console.error("生图失败", error);

        return response
          .status(500)
          .json({
            error: {
              code: "INTERNAL_ERROR",
              message:
                errorMessage ||
                "生成失败，请稍后重试"
            },
            credits: balance,
            refunded
          });
      }
      finally {
        releaseGeneration?.();
      }
    }
  );

  router.get(
    "/api/images/tasks/:provider/:taskId",
    requireAuth,
    async (request, response) => {
      const user =
        getAuthenticatedUser(request);

      try {
        const provider =
          readRouteParam(
            request.params.provider
          );

        const taskId =
          readRouteParam(
            request.params.taskId
          );

        const validProviders =
          new Set<ProviderId>(["lingke"]);

        if (
          !provider ||
          !validProviders.has(
            provider as ProviderId
          )
        ) {
          return response.status(400).json({
            error: {
              code: "INVALID_PROVIDER",
              message:
                "该厂商不支持异步任务查询"
            }
          });
        }

        if (!taskId) {
          return response.status(400).json({
            error: {
              code: "INVALID_TASK_ID",
              message: "缺少 task_id"
            }
          });
        }

        const usage =
          await authService
            .getUsageRecordByRequestId(
              user.id,
              taskId
            );

        if (
          !usage ||
          usage.provider !== provider
        ) {
          return response.status(404).json({
            error: {
              code: "TASK_NOT_FOUND",
              message: "生成任务不存在"
            }
          });
        }

        const persistentTask =
          await findGenerationTaskByProviderTaskId(
            database,
            user.id,
            taskId
          );

        if (
          persistentTask?.status ===
            "success" &&
          persistentTask.historyId
        ) {
          const historyRecord =
            await historyService
              .getByGenerationTaskId(
                persistentTask.id,
                user.id
              );

          if (historyRecord) {
            return response.json({
              success: true,
              result: {
                provider:
                  provider as ProviderId,
                model:
                  usage.model,
                images:
                  historyRecord.images,
                durationMs:
                  historyRecord.durationMs ||
                  0,
                status:
                  "completed",
                progress:
                  "100%",
                cost:
                  historyRecord.cost,
                taskId
              },
              credits:
                user.credits,
              pointsCost:
                persistentTask
                  .actualPoints ||
                0,
              refundAmount:
                persistentTask
                  .refundedPoints,
              taskRecordId:
                persistentTask.id,
              historyRecord
            });
          }
        }

        const result =
          await getImageTask(
            provider as ProviderId,
            taskId,
            usage.model
          );

        if (
          persistentTask &&
          result.status !== "completed" &&
          result.status !== "failed"
        ) {
          await updateGenerationTask(
            database,
            persistentTask.id,
            {
              status: "running",
              stage: "processing",
              progress:
                parseProviderProgress(
                  result.progress,
                  Math.max(
                    persistentTask.progress,
                    45
                  )
                ),
              providerProgress:
                result.progress ||
                "AI 正在生成画面"
            }
          );
        }

        let credits = user.credits;
        let pointsCost =
          usage.pointsCost || 0;
        let refundAmount = 0;

        // 异步历史记录外层作用域
        let historyRecord:
          Awaited<
            ReturnType<
              HistoryService["save"]
            >
          > |
          undefined;

        if (
          result.status === "completed" ||
          result.status === "failed"
        ) {
          const successful =
            result.status === "completed" &&
            result.images.length > 0;

          const unitPoints =
            usage.imageCount > 0
              ? (usage.pointsCost || 0) /
                usage.imageCount
              : (
                  modelSettingsService.get(
                    provider,
                    usage.model
                  )?.points || 0
                );

          if (
            successful &&
            persistentTask
          ) {
            const runtimeModel =
              modelSettingsService.get(
                provider,
                usage.model
              );

            historyRecord =
              await archiveGenerationResult(
                {
                  database,
                  historyService,
                  taskId:
                    persistentTask.id,
                  userId:
                    user.id,
                  username:
                    user.username,
                  provider:
                    "lingke",
                  providerName:
                    runtimeModel
                      ?.capability
                      .providerName ||
                    "百嘉瑞AI",
                  model:
                    usage.model,
                  prompt:
                    usage.prompt ||
                    "AI 图片生成",
                  operation:
                    usage.operation,
                  size:
                    usage.size,
                  result,
                  clientIp:
                    request.ip,
                  userAgent:
                    request.get(
                      "user-agent"
                    )
                }
              );

            await updateGenerationTask(
              database,
              persistentTask.id,
              {
                status: "running",
                stage: "settling",
                progress: 98,
                historyId:
                  historyRecord.id,
                providerProgress:
                  "正在结算积分"
              }
            );
          }

          const finalized =
            await authService.finalizeAsyncUsage(
              user.id,
              taskId,
              {
                status:
                  successful
                    ? "success"
                    : "failed",
                imageCount:
                  result.images.length,
                actualPointsCost:
                  successful
                    ? calculateGenerationCreditCost(
                        unitPoints,
                        result.images.length
                      )
                    : 0,
                durationMs:
                  result.durationMs,
                cost: result.cost,
                error:
                  successful
                    ? undefined
                    : result.error ||
                      "异步任务未返回图片"
              }
            );

          credits = finalized.balance;
          pointsCost =
            finalized.pointsCost;
          refundAmount =
            finalized.refundAmount;

          if (persistentTask) {
            await updateGenerationTask(
              database,
              persistentTask.id,
              {
                status:
                  successful
                    ? "success"
                    : "failed",
                stage:
                  successful
                    ? "completed"
                    : finalized.refunded
                      ? "refunded"
                      : "failed",
                progress: 100,
                actualImageCount:
                  result.images.length,
                historyId:
                  historyRecord?.id,
                actualPoints:
                  finalized.pointsCost,
                refundedPoints:
                  finalized.refundAmount,
                providerProgress:
                  result.progress ||
                  "100%",
                errorCode:
                  successful
                    ? undefined
                    : "PROVIDER_TASK_FAILED",
                errorMessage:
                  successful
                    ? undefined
                    : result.error ||
                      "异步任务未返回图片",
                markCompleted: true
              }
            );
          }
        }

        return response.json({
          success: true,
          result,
          credits,
          pointsCost,
          refundAmount,
          taskRecordId:
            persistentTask?.id,
          historyRecord
        });
      }
      catch (error) {
        if (
          error instanceof
          ProviderHttpError
        ) {
          console.error(
            "异步任务接口错误",
            error.details
          );

          return response
            .status(
              error.status >= 400 &&
              error.status < 600
                ? error.status
                : 502
            )
            .json({
              error: {
                code: "PROVIDER_ERROR",
                message: error.message
              }
            });
        }

        if (error instanceof AuthError) {
          return sendAuthError(
            response,
            error,
            "任务查询失败"
          );
        }

        console.error(
          "任务查询失败",
          error
        );

        return response.status(500).json({
          error: {
            code: "TASK_QUERY_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "任务查询失败"
          }
        });
      }
    }
  );

  return router;
}

function buildUsageInputFromRawRequest(
  value: unknown,
  userId: string
): Omit<UsageRecordInput, "status"> {
  const body =
    value &&
    typeof value === "object"
      ? value as Record<string, unknown>
      : {};

  const images =
    Array.isArray(body.images)
      ? body.images
      : [];

  return {
    userId,
    provider:
      typeof body.provider === "string"
        ? body.provider
        : "unknown",
    model:
      typeof body.model === "string"
        ? body.model
        : "unknown",
    operation:
      images.length > 0
        ? "image-edit"
        : "text-to-image",
    size:
      typeof body.size === "string"
        ? body.size
        : "auto",
    prompt:
      typeof body.prompt === "string"
        ? body.prompt
        : undefined,
    imageCount:
      typeof body.count === "number"
        ? body.count
        : 0
  };
}

async function safeRecordUsage(
  authService: AuthService,
  input: UsageRecordInput
): Promise<void> {
  try {
    await authService.recordUsage(input);
  }
  catch (error) {
    console.error(
      "保存使用记录失败",
      error
    );
  }
}

async function rejectGeneration(
  authService: AuthService,
  response: Response,
  usageInput:
    Omit<UsageRecordInput, "status">,
  code: string,
  message: string
): Promise<Response> {
  await safeRecordUsage(
    authService,
    {
      ...usageInput,
      status: "failed",
      error: message
    }
  );

  return response.status(400).json({
    error: {
      code,
      message
    }
  });
}

function readTaskThumbnail(
  value: unknown
): string | undefined {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return undefined;
  }

  const thumbnail =
    (value as Record<string, unknown>)
      .taskThumbnail;

  return (
    typeof thumbnail === "string" &&
    thumbnail.startsWith("data:image/") &&
    thumbnail.length <= 700_000
  )
    ? thumbnail
    : undefined;
}

function generationErrorCode(
  error: unknown
): string {
  if (error instanceof AuthError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_REQUEST";
  }

  if (error instanceof ProviderHttpError) {
    return "PROVIDER_ERROR";
  }

  return "INTERNAL_ERROR";
}

function readBatchItemId(
  value: unknown
): string | undefined {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return undefined;
  }

  const candidate =
    (value as {
      batchItemId?: unknown
    }).batchItemId;

  return (
    typeof candidate === "string" &&
    /^[0-9a-f-]{36}$/i.test(candidate)
  )
    ? candidate
    : undefined;
}

function readPositiveEnv(
  name: string,
  fallback: number
): number {
  const value =
    Number(process.env[name]);

  return (
    Number.isFinite(value) &&
    value > 0
  )
    ? Math.trunc(value)
    : fallback;
}