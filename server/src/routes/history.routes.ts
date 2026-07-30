import { Router, type RequestHandler } from "express";
import type { HistoryService } from "../history.js";
import { HistoryValidationError, parseHistorySaveInput } from "../history.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { readLimit, readRouteParam } from "../utils/express.js";

export function createHistoryRouter(options: {
  historyService: HistoryService;
  requireAuth: RequestHandler;
}): Router {
  const { historyService, requireAuth } = options;
  const router = Router();

  router.get("/generated/:filename", requireAuth, async (request, response) => {
    try {
      const user = getAuthenticatedUser(request);
      const fileName = readRouteParam(request.params.filename);
      if (!fileName) return response.status(400).json({ error: { code: "INVALID_IMAGE_FILE", message: "图片文件名不正确" } });
      const filePath = historyService.resolveGeneratedFile(fileName);
      if (!filePath) return response.status(400).json({ error: { code: "INVALID_IMAGE_FILE", message: "图片文件名不正确" } });
      const allowed = await historyService.canAccessGeneratedFile(fileName, user.id, user.role === "admin");
      if (!allowed) return response.status(404).json({ error: { code: "IMAGE_NOT_FOUND", message: "图片不存在" } });
      response.setHeader("Cache-Control", "private, max-age=2592000");
      return response.sendFile(filePath, { dotfiles: "deny" }, (error) => {
        if (error && !response.headersSent) response.status(404).json({ error: { code: "IMAGE_NOT_FOUND", message: "图片不存在" } });
      });
    } catch (error) {
      console.error("Generated image access error", error);
      return response.status(500).json({ error: { code: "IMAGE_ACCESS_ERROR", message: "读取图片失败" } });
    }
  });

  router.get("/api/history", requireAuth, async (request, response) => {
    try {
      const history = await historyService.list(readLimit(request.query.limit, 20), getAuthenticatedUser(request).id);
      return response.json({ history });
    } catch (error) {
      console.error("History list error", error);
      return response.status(500).json({ error: { code: "HISTORY_LIST_ERROR", message: "读取生成历史失败" } });
    }
  });

  router.get(
    "/api/history/:id",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const historyId =
          readRouteParam(
            request.params.id
          );

        if (!historyId) {
          return response.status(400).json({
            error: {
              code:
                "INVALID_HISTORY_ID",
              message:
                "缺少历史记录 ID"
            }
          });
        }

        const record =
          await historyService.getById(
            historyId,
            user.id
          );

        if (!record) {
          return response.status(404).json({
            error: {
              code:
                "HISTORY_NOT_FOUND",
              message:
                "历史记录不存在"
            }
          });
        }

        return response.json({
          record
        });
      } catch (error) {
        console.error(
          "History detail error",
          error
        );

        return response.status(500).json({
          error: {
            code:
              "HISTORY_DETAIL_ERROR",
            message:
              "读取历史记录失败"
          }
        });
      }
    }
  );

  router.post("/api/history", requireAuth, async (request, response) => {
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

  router.delete("/api/history/:id", requireAuth, async (request, response) => {
    try {
      const historyId = readRouteParam(request.params.id);
      if (!historyId) return response.status(400).json({ error: { code: "INVALID_HISTORY_ID", message: "缺少历史记录 ID" } });
      const removed = await historyService.remove(historyId, getAuthenticatedUser(request).id);
      if (!removed) return response.status(404).json({ error: { code: "HISTORY_NOT_FOUND", message: "历史记录不存在" } });
      return response.json({ success: true });
    } catch (error) {
      console.error("History delete error", error);
      return response.status(500).json({ error: { code: "HISTORY_DELETE_ERROR", message: "删除历史记录失败" } });
    }
  });

  router.delete("/api/history", requireAuth, async (request, response) => {
    try {
      await historyService.clear(getAuthenticatedUser(request).id);
      return response.json({ success: true });
    } catch (error) {
      console.error("History clear error", error);
      return response.status(500).json({ error: { code: "HISTORY_CLEAR_ERROR", message: "清空历史记录失败" } });
    }
  });

  return router;
}
