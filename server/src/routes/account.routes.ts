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
  HistoryService
} from "../history.js";
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
  listGalleryEligibleWorks,
  listPublicGallery,
  listUserGallerySubmissions,
  submitGalleryWork,
  withdrawGallerySubmission
} from "../services/gallery.js";
import {
  getStorageAccountSummary,
  redeemStoragePackage
} from "../services/storage-entitlements.js";
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
    historyService: HistoryService;
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
    historyService,
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
    "/api/gallery",
    async (request, response) => {
      try {
        return response.json(
          await listPublicGallery(
            database,
            {
              page:
                readQueryNumber(
                  request.query.page,
                  1
                ),
              pageSize:
                readQueryNumber(
                  request.query.pageSize,
                  24
                ),
              search:
                readQueryText(
                  request.query.search
                ),
              provider:
                readQueryText(
                  request.query.provider
                ),
              sort:
                request.query.sort ===
                  "newest"
                  ? "newest"
                  : "featured",
              featured:
                request.query.featured ===
                  "true" ||
                request.query.featured ===
                  "1"
            }
          )
        );
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取作品广场失败"
        );
      }
    }
  );

  router.get(
    "/api/gallery/:id/image",
    async (request, response) => {
      try {
        const id =
          readRouteParam(
            request.params.id
          );

        if (!id) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_GALLERY_ID",
                message:
                  "作品标识不正确"
              }
            });
        }

        const [rows] =
          await database.pool.query<
            RowDataPacket[]
          >(
            `SELECT i.file_name
             FROM app_gallery_submissions s
             INNER JOIN app_history_images i
               ON i.id = s.image_id
             WHERE
               s.id = ?
               AND s.status = 'approved'
             LIMIT 1`,
            [id]
          );

        const fileName =
          rows[0]?.file_name
            ? String(
                rows[0].file_name
              )
            : "";

        if (!fileName) {
          return response
            .status(404)
            .json({
              error: {
                code:
                  "GALLERY_IMAGE_NOT_FOUND",
                message:
                  "作品图片不存在"
              }
            });
        }

        const filePath =
          historyService
            .resolveGeneratedFile(
              fileName
            );

        if (!filePath) {
          return response
            .status(404)
            .json({
              error: {
                code:
                  "GALLERY_IMAGE_NOT_FOUND",
                message:
                  "作品图片不存在"
              }
            });
        }

        response.setHeader(
          "Cache-Control",
          "public, max-age=3600"
        );

        return response.sendFile(
          filePath,
          {
            dotfiles: "deny"
          },
          (error) => {
            if (
              error &&
              !response.headersSent
            ) {
              response
                .status(404)
                .json({
                  error: {
                    code:
                      "GALLERY_IMAGE_NOT_FOUND",
                    message:
                      "作品图片不存在"
                  }
                });
            }
          }
        );
      } catch (error) {
        console.error(
          "Gallery image access error",
          error
        );

        return response
          .status(500)
          .json({
            error: {
              code:
                "GALLERY_IMAGE_ACCESS_ERROR",
              message:
                "读取作品图片失败"
            }
          });
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
    "/api/account/gallery/eligible",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        return response.json({
          works:
            await listGalleryEligibleWorks(
              database,
              user.id
            )
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取可投稿作品失败"
        );
      }
    }
  );

  router.get(
    "/api/account/gallery/submissions",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        return response.json({
          submissions:
            await listUserGallerySubmissions(
              database,
              user.id
            )
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取投稿记录失败"
        );
      }
    }
  );

  router.post(
    "/api/account/gallery/submissions",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const submission =
          await submitGalleryWork(
            database,
            user.id,
            request.body || {}
          );

        return response
          .status(201)
          .json({
            success: true,
            submission
          });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "提交作品失败"
        );
      }
    }
  );

  router.delete(
    "/api/account/gallery/submissions/:id",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const id =
          readRouteParam(
            request.params.id
          );

        if (!id) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_GALLERY_ID",
                message:
                  "缺少投稿标识"
              }
            });
        }

        await withdrawGallerySubmission(
          database,
          user.id,
          id
        );

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "撤回投稿失败"
        );
      }
    }
  );

  router.get(
    "/api/account/storage",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        return response.json(
          await getStorageAccountSummary(
            database,
            user.id
          )
        );
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取存储权益失败"
        );
      }
    }
  );

  router.post(
    "/api/account/storage/redeem",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const packageId =
          typeof request.body
            ?.packageId === "string"
            ? request.body
                .packageId
                .trim()
            : "";

        if (!packageId) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_STORAGE_PACKAGE",
                message:
                  "请选择存储兑换方案"
              }
            });
        }

        const result =
          await redeemStoragePackage(
            database,
            user.id,
            packageId
          );

        return response.json({
          success: true,
          ...result
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "兑换存储权益失败"
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
