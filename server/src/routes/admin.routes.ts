import type { AppDatabase } from "../db/database.js";
import type { HistoryService } from "../history.js";
import {
  failAndRefundAdminTask,
  queryAdminTasks,
  readAdminTaskHealth,
  type AdminTaskStatusFilter
} from "../services/admin-generation-tasks.js";
import {
  runTaskRecoveryOnce
} from "../services/async-reconciliation.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  updateAnnouncement
} from "../services/announcements.js";
import {
  deleteAdminGallerySubmission,
  listAdminGallerySubmissions,
  reviewGallerySubmission
} from "../services/gallery.js";
import {
  createStoragePackage,
  deleteStoragePackage,
  listStoragePackages,
  readStorageSettings,
  updateStoragePackage,
  updateStorageSettings
} from "../services/storage-entitlements.js";
import {
  createUserGroup,
  deleteSiteMessage,
  deleteUserGroup,
  listAdminSiteMessages,
  listAudienceUsers,
  listUserGroups,
  sendSiteMessage,
  setAudienceUserGroups,
  updateUserGroup
} from "../services/user-messaging.js";
import { Router, type Request, type RequestHandler } from "express";
import type { AuthService } from "../auth.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import type { AuditLogService } from "../services/audit-log.js";
import type { AdminQueryService } from "../services/admin-query.js";
import type {
  InvitationRewardService
} from "../services/invitation-rewards.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { readRouteParam, sendAuthError } from "../utils/express.js";

export function createAdminRouter(options: {
  database: AppDatabase;
  authService: AuthService;
  historyService: HistoryService;
  modelSettingsService: ModelSettingsService;
  auditLogService: AuditLogService;
  adminQueryService: AdminQueryService;
  invitationRewardService:
    InvitationRewardService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}): Router {
  const {
    database,
    authService,
    historyService,
    modelSettingsService,
    auditLogService,
    adminQueryService,
    invitationRewardService,
    requireAuth,
    requireAdmin
  } = options;
  const router = Router();
  const protectedAdmin = [requireAuth, requireAdmin] as const;

  router.get("/api/admin/dashboard", ...protectedAdmin, async (_request, response) => {
    try { return response.json(await adminQueryService.dashboard()); }
    catch (error) { return sendAuthError(response, error, "读取站长看板失败"); }
  });


  router.get("/api/admin/announcements", ...protectedAdmin, async (_request, response) => {
    try {
      return response.json({ announcements: await listAdminAnnouncements(database) });
    } catch (error) {
      return sendAuthError(response, error, "读取公告列表失败");
    }
  });

  router.post("/api/admin/announcements", ...protectedAdmin, async (request, response) => {
    try {
      const actor = getAuthenticatedUser(request);
      const announcement = await createAnnouncement(database, request.body || {}, actor.id);
      await auditLogService.safeRecord({ actor, action: "announcement.create", targetType: "announcement", targetId: announcement.id, summary: "发布公告：" + announcement.title, context: auditContext(request) });
      return response.status(201).json({ success: true, announcement });
    } catch (error) {
      return sendAuthError(response, error, "发布公告失败");
    }
  });

  router.patch("/api/admin/announcements/:id", ...protectedAdmin, async (request, response) => {
    try {
      const id = requiredId(request.params.id, response, "INVALID_ANNOUNCEMENT_ID", "缺少公告 ID");
      if (!id) return;
      const actor = getAuthenticatedUser(request);
      const announcement = await updateAnnouncement(database, id, request.body || {}, actor.id);
      await auditLogService.safeRecord({ actor, action: "announcement.update", targetType: "announcement", targetId: id, summary: "更新公告：" + announcement.title, context: auditContext(request) });
      return response.json({ success: true, announcement });
    } catch (error) {
      return sendAuthError(response, error, "更新公告失败");
    }
  });

  router.delete("/api/admin/announcements/:id", ...protectedAdmin, async (request, response) => {
    try {
      const id = requiredId(request.params.id, response, "INVALID_ANNOUNCEMENT_ID", "缺少公告 ID");
      if (!id) return;
      const actor = getAuthenticatedUser(request);
      await deleteAnnouncement(database, id);
      await auditLogService.safeRecord({ actor, action: "announcement.delete", targetType: "announcement", targetId: id, summary: "删除公告", context: auditContext(request) });
      return response.json({ success: true });
    } catch (error) {
      return sendAuthError(response, error, "删除公告失败");
    }
  });

  router.get(
    "/api/admin/audience/groups",
    ...protectedAdmin,
    async (_request, response) => {
      try {
        return response.json({
          groups:
            await listUserGroups(
              database
            )
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取用户分组失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/audience/groups",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const actor =
          getAuthenticatedUser(
            request
          );

        const group =
          await createUserGroup(
            database,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "audience.group.create",
          targetType:
            "user_group",
          targetId:
            group.id,
          summary:
            "创建用户分组：" +
            group.name,
          context:
            auditContext(
              request
            )
        });

        return response
          .status(201)
          .json({
            success: true,
            group
          });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "创建用户分组失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/audience/groups/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_USER_GROUP_ID",
            "缺少用户分组 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const group =
          await updateUserGroup(
            database,
            id,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "audience.group.update",
          targetType:
            "user_group",
          targetId:
            id,
          summary:
            "更新用户分组：" +
            group.name,
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true,
          group
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "更新用户分组失败"
        );
      }
    }
  );

  router.delete(
    "/api/admin/audience/groups/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_USER_GROUP_ID",
            "缺少用户分组 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const group =
          await deleteUserGroup(
            database,
            id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "audience.group.delete",
          targetType:
            "user_group",
          targetId:
            id,
          summary:
            "删除用户分组：" +
            group.name,
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除用户分组失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/audience/users",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const result =
          await listAudienceUsers(
            database,
            {
              ...readPage(
                request
              ),
              search:
                readText(
                  request.query.search,
                  80
                ),
              status:
                readText(
                  request.query.status,
                  20
                )
            }
          );

        return response.json({
          users:
            result.items,
          pagination:
            result.pagination
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取用户分组成员失败"
        );
      }
    }
  );

  router.put(
    "/api/admin/audience/users/:id/groups",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const userId =
          requiredId(
            request.params.id,
            response,
            "INVALID_USER_ID",
            "缺少用户 ID"
          );

        if (!userId) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const user =
          await setAudienceUserGroups(
            database,
            userId,
            request.body
              ?.groupIds,
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "audience.membership.update",
          targetType:
            "user",
          targetId:
            userId,
          summary:
            "更新用户分组：" +
            user.username,
          details: {
            groupIds:
              user.groupIds
          },
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true,
          user
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "保存用户分组失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/messages",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const result =
          await listAdminSiteMessages(
            database,
            readPage(
              request
            )
          );

        return response.json({
          messages:
            result.items,
          pagination:
            result.pagination
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取站内消息失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/messages",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const actor =
          getAuthenticatedUser(
            request
          );

        const message =
          await sendSiteMessage(
            database,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "message.send",
          targetType:
            "site_message",
          targetId:
            message.id,
          summary:
            "发送站内消息：" +
            message.title,
          details: {
            targetType:
              message.targetType,
            deliveredCount:
              message.deliveredCount
          },
          context:
            auditContext(
              request
            )
        });

        return response
          .status(201)
          .json({
            success: true,
            message
          });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "发送站内消息失败"
        );
      }
    }
  );

  router.delete(
    "/api/admin/messages/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_MESSAGE_ID",
            "缺少消息 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const message =
          await deleteSiteMessage(
            database,
            id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "message.delete",
          targetType:
            "site_message",
          targetId:
            id,
          summary:
            "删除站内消息：" +
            message.title,
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除站内消息失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/gallery",
    ...protectedAdmin,
    async (request, response) => {
      try {
        return response.json(
          await listAdminGallerySubmissions(
            database,
            {
              ...readPage(
                request
              ),
              status:
                readText(
                  request.query.status,
                  20
                ) as
                  | "all"
                  | "pending"
                  | "approved"
                  | "rejected"
                  | "withdrawn"
                  | undefined,
              search:
                readText(
                  request.query.search,
                  120
                )
            }
          )
        );
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取作品投稿失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/gallery/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_GALLERY_ID",
            "缺少投稿 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const submission =
          await reviewGallerySubmission(
            database,
            id,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "gallery.review",
          targetType:
            "gallery_submission",
          targetId:
            id,
          summary:
            submission.status ===
              "approved"
              ? "通过作品投稿：" +
                submission.title
              : submission.status ===
                  "rejected"
                ? "拒绝作品投稿：" +
                  submission.title
                : "更新作品投稿：" +
                  submission.title,
          details: {
            status:
              submission.status,
            featured:
              submission.featured
          },
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true,
          submission
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "保存作品审核失败"
        );
      }
    }
  );

  router.delete(
    "/api/admin/gallery/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_GALLERY_ID",
            "缺少投稿 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const removed =
          await deleteAdminGallerySubmission(
            database,
            id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "gallery.delete",
          targetType:
            "gallery_submission",
          targetId:
            id,
          summary:
            "删除投稿记录：" +
            removed.title,
          details: {
            status:
              removed.status
          },
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除投稿记录失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/storage-packages",
    ...protectedAdmin,
    async (_request, response) => {
      try {
        const [
          settings,
          packages
        ] =
          await Promise.all([
            readStorageSettings(
              database
            ),
            listStoragePackages(
              database,
              true
            )
          ]);

        return response.json({
          settings,
          packages
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取存储策略失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/storage-settings",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const actor =
          getAuthenticatedUser(
            request
          );

        const settings =
          await updateStorageSettings(
            database,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "storage.settings",
          targetType:
            "storage_policy",
          targetId:
            "1",
          summary:
            "更新服务器存储策略",
          details:
            settings,
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true,
          settings
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "保存存储策略失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/storage-packages",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const actor =
          getAuthenticatedUser(
            request
          );

        const storagePackage =
          await createStoragePackage(
            database,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "storage.package.create",
          targetType:
            "storage_package",
          targetId:
            storagePackage.id,
          summary:
            "创建存储方案：" +
            storagePackage.name,
          context:
            auditContext(
              request
            )
        });

        return response
          .status(201)
          .json({
            success: true,
            package:
              storagePackage
          });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "创建存储方案失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/storage-packages/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_STORAGE_PACKAGE",
            "缺少存储方案 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const storagePackage =
          await updateStoragePackage(
            database,
            id,
            request.body || {},
            actor.id
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "storage.package.update",
          targetType:
            "storage_package",
          targetId:
            id,
          summary:
            "更新存储方案：" +
            storagePackage.name,
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true,
          package:
            storagePackage
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "更新存储方案失败"
        );
      }
    }
  );

  router.delete(
    "/api/admin/storage-packages/:id",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const id =
          requiredId(
            request.params.id,
            response,
            "INVALID_STORAGE_PACKAGE",
            "缺少存储方案 ID"
          );

        if (!id) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        await deleteStoragePackage(
          database,
          id
        );

        await auditLogService.safeRecord({
          actor,
          action:
            "storage.package.delete",
          targetType:
            "storage_package",
          targetId:
            id,
          summary:
            "删除存储方案",
          context:
            auditContext(
              request
            )
        });

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除存储方案失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/tasks",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const result =
          await queryAdminTasks(
            database,
            {
              ...readPage(request),
              status:
                readText(
                  request.query.status,
                  20
                ) as
                  | AdminTaskStatusFilter
                  | undefined,
              provider:
                readText(
                  request.query.provider,
                  80
                ),
              search:
                readText(
                  request.query.search,
                  200
                ),
              staleOnly:
                readBoolean(
                  request.query.staleOnly
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
          "读取任务管理列表失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/tasks/health",
    ...protectedAdmin,
    async (_request, response) => {
      try {
        return response.json(
          await readAdminTaskHealth(
            database
          )
        );
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取任务健康统计失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/tasks/recover",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const actor =
          getAuthenticatedUser(
            request
          );

        const stats =
          await runTaskRecoveryOnce(
            database,
            authService,
            historyService,
            modelSettingsService,
            200
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "generation_task.recover",
          targetType:
            "generation_task",
          summary:
            "站长手动运行任务恢复扫描",
          details:
            stats,
          context:
            auditContext(request)
        });

        return response.json({
          success: true,
          stats
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "运行任务恢复扫描失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/tasks/:id/fail-refund",
    ...protectedAdmin,
    async (request, response) => {
      try {
        const taskId =
          requiredId(
            request.params.id,
            response,
            "INVALID_TASK_ID",
            "缺少任务 ID"
          );

        if (!taskId) return;

        const actor =
          getAuthenticatedUser(
            request
          );

        const body =
          request.body as {
            reason?: unknown
          };

        const reason =
          typeof body?.reason ===
            "string"
            ? body.reason
            : "站长手动终止异常任务";

        const result =
          await failAndRefundAdminTask(
            database,
            authService,
            taskId,
            reason
          );

        await auditLogService.safeRecord({
          actor,
          action:
            "generation_task.fail_refund",
          targetType:
            "generation_task",
          targetId:
            taskId,
          summary:
            `终止任务并退款：${result.task.username} · ${result.task.model}`,
          details: {
            reason,
            refundedPoints:
              result.refundedPoints,
            status:
              result.task.status
          },
          context:
            auditContext(request)
        });

        return response.json({
          success: true,
          task:
            result.task,
          refundedPoints:
            result.refundedPoints
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "终止任务并退款失败"
        );
      }
    }
  );

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
      const body = request.body as { username?: unknown; status?: unknown; adminNote?: unknown };
      let user = await authService.updateUser(
        userId,
        {
          username: body?.username,
          status: body?.status,
          adminNote: body?.adminNote
        },
        actor.id
      );
      if (body?.status === "active") {
        try {
          user =
            await invitationRewardService
              .rewardActivatedUser(userId) ||
            user;
        }
        catch (invitationError) {
          console.error(
            "发放邀请奖励失败",
            invitationError
          );
        }
      }
      await auditLogService.safeRecord({ actor, action: "user.update", targetType: "user", targetId: userId, summary: `更新用户 ${user.username}`, details: body, context: auditContext(request) });
      return response.json({ success: true, user });
    } catch (error) { return sendAuthError(response, error, "更新用户失败"); }
  });

  router.post("/api/admin/users/:id/reset-password", ...protectedAdmin, async (request, response) => {
    try {
      const userId = requiredId(request.params.id, response, "INVALID_USER_ID", "缺少用户 ID");
      if (!userId) return;
      const actor = getAuthenticatedUser(request);
      const body = request.body as { newPassword?: unknown };
      const user = await authService.resetPassword(userId, body?.newPassword, actor.id);
      await auditLogService.safeRecord({ actor, action: "user.reset_password", targetType: "user", targetId: userId, summary: "重置用户 " + user.username + " 密码", details: { mustChangePassword: true }, context: auditContext(request) });
      return response.json({ success: true, user });
    } catch (error) {
      return sendAuthError(response, error, "重置用户密码失败");
    }
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
function readBoolean(value: unknown) {
  return value === "true" || value === "1";
}

function requiredId(value: string | string[] | undefined, response: import("express").Response, code: string, message: string) {
  const id = readRouteParam(value);
  if (!id) { response.status(400).json({ error: { code, message } }); return undefined; }
  return id;
}
function auditContext(request: Request) { return { clientIp: request.ip, userAgent: request.get("user-agent") }; }
