import {
  Router
} from "express";
import type {
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import type {
  AuthService
} from "../auth.js";
import type {
  ModelSettingsService
} from "../services/model-settings.js";
import {
  getGenerationTaskById,
  linkGenerationTaskHistory,
  queryGenerationTasks,
  type GenerationTaskStatusFilter
} from "../services/generation-tasks.js";
import {
  listActiveAnnouncements
} from "../services/announcements.js";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import {
  readLimit,
  readRouteParam,
  sendAuthError
} from "../utils/express.js";

export function createAccountRouter(
  options: {
    database: AppDatabase;
    authService: AuthService;
    modelSettingsService:
      ModelSettingsService;
    requireAuth:
      import("express")
        .RequestHandler;
  }
): Router {
  const {
    database,
    authService,
    modelSettingsService,
    requireAuth
  } = options;

  const router = Router();

  router.get(
    "/api/announcements/active",
    async (_request, response) => {
      try {
        return response.json({
          announcements: await listActiveAnnouncements(database)
        });
      } catch (error) {
        return sendAuthError(response, error, "读取公告失败");
      }
    }
  );

  router.get(
    "/api/account/summary",
    requireAuth,
    (request, response) => {
      response.json({
        user:
          getAuthenticatedUser(
            request
          ),
        prices:
          modelSettingsService
            .getPriceList()
      });
    }
  );

  router.patch(
    "/api/account/profile",
    requireAuth,
    async (request, response) => {
      try {
        const user = getAuthenticatedUser(request);
        const body = request.body as { nickname?: unknown };
        return response.json({
          success: true,
          user: await authService.updateProfile(user.id, body?.nickname)
        });
      } catch (error) {
        return sendAuthError(response, error, "保存个人资料失败");
      }
    }
  );

  router.post(
    "/api/account/password",
    requireAuth,
    async (request, response) => {
      try {
        const user = getAuthenticatedUser(request);
        const body = request.body as { currentPassword?: unknown; newPassword?: unknown };
        await authService.changePassword(user.id, body?.currentPassword, body?.newPassword);
        return response.json({ success: true });
      } catch (error) {
        return sendAuthError(response, error, "修改密码失败");
      }
    }
  );

  router.get(
    "/api/account/usage",
    requireAuth,
    async (request, response) => {
      try {
        return response.json({
          records:
            await authService
              .listUsageRecords(
                getAuthenticatedUser(
                  request
                ).id,
                readLimit(
                  request.query.limit,
                  200
                )
              )
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取 AI 使用记录失败"
        );
      }
    }
  );

  router.get(
    "/api/account/tasks",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const result =
          await queryGenerationTasks(
            database,
            user.id,
            {
              page:
                readQueryNumber(
                  request.query.page,
                  1
                ),
              pageSize:
                readTaskPageSize(
                  request.query.pageSize,
                  request.query.limit
                ),
              status:
                readTaskStatus(
                  request.query.status
                ),
              provider:
                readQueryText(
                  request.query.provider
                ),
              model:
                readQueryText(
                  request.query.model
                ),
              search:
                readQueryText(
                  request.query.search
                )
            }
          );

        return response.json({
          tasks:
            result.items,
          pagination:
            result.pagination,
          summary:
            result.summary
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取生成任务失败"
        );
      }
    }
  );

  router.get(
    "/api/account/tasks/:taskId",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const taskId =
          readRouteParam(
            request.params.taskId
          );

        if (!taskId) {
          return response.status(400).json({
            error: {
              code:
                "INVALID_TASK_ID",
              message:
                "缺少任务标识"
            }
          });
        }

        const task =
          await getGenerationTaskById(
            database,
            user.id,
            taskId
          );

        if (!task) {
          return response.status(404).json({
            error: {
              code:
                "TASK_NOT_FOUND",
              message:
                "生成任务不存在"
            }
          });
        }

        return response.json({
          task
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取任务详情失败"
        );
      }
    }
  );

  router.post(
    "/api/account/tasks/:taskId/link-history",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const taskId =
          readRouteParam(
            request.params.taskId
          );

        const historyId =
          typeof request.body
            ?.historyId === "string"
            ? request.body
                .historyId
                .trim()
            : "";

        if (
          !taskId ||
          !historyId
        ) {
          return response.status(400).json({
            error: {
              code:
                "INVALID_TASK_HISTORY_LINK",
              message:
                "缺少任务或历史记录标识"
            }
          });
        }

        const [historyRows] =
          await database.pool.query<
            RowDataPacket[]
          >(
            `SELECT id
             FROM app_history_records
             WHERE
               id = ?
               AND owner_user_id = ?
               AND deleted_at IS NULL
             LIMIT 1`,
            [
              historyId,
              user.id
            ]
          );

        if (!historyRows[0]) {
          return response.status(404).json({
            error: {
              code:
                "HISTORY_NOT_FOUND",
              message:
                "生成结果不存在"
            }
          });
        }

        const linked =
          await linkGenerationTaskHistory(
            database,
            user.id,
            taskId,
            historyId
          );

        if (!linked) {
          return response.status(404).json({
            error: {
              code:
                "TASK_NOT_FOUND",
              message:
                "生成任务不存在"
            }
          });
        }

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "关联任务结果失败"
        );
      }
    }
  );

  router.get(
    "/api/account/credits",
    requireAuth,
    async (request, response) => {
      try {
        return response.json({
          records:
            await authService
              .listCreditTransactions(
                getAuthenticatedUser(
                  request
                ).id,
                readLimit(
                  request.query.limit,
                  300
                )
              )
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取积分明细失败"
        );
      }
    }
  );

  router.post(
    "/api/account/redeem",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const body =
          request.body as {
            code?: unknown
          };

        const result =
          await authService
            .redeemRechargeCard(
              user.id,
              body?.code
            );

        return response.json({
          success: true,
          user:
            result.user,
          transaction:
            result.transaction
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "卡密充值失败"
        );
      }
    }
  );

  return router;
}

function readQueryNumber(
  value: unknown,
  fallback: number
): number {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  const numeric =
    Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function readTaskPageSize(
  pageSize: unknown,
  legacyLimit: unknown
): number {
  if (
    typeof pageSize === "string"
  ) {
    return readQueryNumber(
      pageSize,
      20
    );
  }

  if (
    typeof legacyLimit === "string"
  ) {
    return readQueryNumber(
      legacyLimit,
      20
    );
  }

  return 20;
}

function readQueryText(
  value: unknown
): string | undefined {
  return (
    typeof value === "string" &&
    value.trim()
  )
    ? value.trim()
    : undefined;
}

function readTaskStatus(
  value: unknown
): GenerationTaskStatusFilter {
  return (
    value === "active" ||
    value === "queued" ||
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "cancelled"
  )
    ? value
    : "all";
}
