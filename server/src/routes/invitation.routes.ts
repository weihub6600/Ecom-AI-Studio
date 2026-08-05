import {
  Router,
  type RequestHandler
} from "express";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import type {
  InvitationRewardService
} from "../services/invitation-rewards.js";
import {
  sendAuthError
} from "../utils/express.js";

export function createInvitationRouter(
  options: {
    invitationRewardService:
      InvitationRewardService;
    requireAuth: RequestHandler;
    requireAdmin: RequestHandler;
  }
): Router {
  const {
    invitationRewardService,
    requireAuth,
    requireAdmin
  } = options;

  const router = Router();

  router.get(
    "/api/account/invitation",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(request);

        return response.json(
          await invitationRewardService
            .getUserDashboard(user.id)
        );
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "读取邀请奖励失败"
        );
      }
    }
  );

  router.get(
    "/api/admin/invitation-settings",
    requireAuth,
    requireAdmin,
    async (_request, response) => {
      try {
        return response.json(
          await invitationRewardService
            .getAdminDashboard()
        );
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "读取邀请奖励设置失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/invitation-settings",
    requireAuth,
    requireAdmin,
    async (request, response) => {
      try {
        const actor =
          getAuthenticatedUser(request);

        const settings =
          await invitationRewardService
            .updateSettings(
              request.body || {},
              actor.id
            );

        return response.json({
          success: true,
          settings
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "保存邀请奖励设置失败"
        );
      }
    }
  );

  return router;
}
