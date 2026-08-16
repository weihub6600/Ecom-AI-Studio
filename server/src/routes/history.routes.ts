import { Router, type RequestHandler } from "express";
import type { HistoryService } from "../history.js";
import {
  HistoryStorageError,
  HistoryValidationError,
  parseHistorySaveInput,
  parseHistorySourceImages
} from "../history.js";
import { getAuthenticatedUser } from "../middleware/auth.js";
import { createSimpleRateLimit } from "../middleware/rate-limit.js";
import { readLimit, readRouteParam } from "../utils/express.js";

export function createHistoryRouter(options: {
  historyService: HistoryService;
  requireAuth: RequestHandler;
}): Router {
  const { historyService, requireAuth } = options;
  const router = Router();

  const historyWriteWindowMs =
    readPositiveIntegerEnv(
      "HISTORY_WRITE_RATE_WINDOW_MS",
      60_000
    );

  /*
   * Shared IP ceiling across history write endpoints.
   * This is intentionally much higher than the per-user
   * limits so normal users behind NAT are not penalized.
   */
  const historyWriteIpRateLimit =
    createSimpleRateLimit({
      windowMs: historyWriteWindowMs,
      maxAttempts:
        readPositiveIntegerEnv(
          "HISTORY_WRITE_IP_RATE_MAX",
          120
        ),
      code:
        "HISTORY_WRITE_IP_RATE_LIMITED",
      message:
        "\u540c\u4e00\u7f51\u7edc\u7684\u5386\u53f2\u8bb0\u5f55\u5199\u5165\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5",
      keyGenerator: (request) =>
        `ip:${
          request.ip ||
          request.socket.remoteAddress ||
          "unknown"
        }`
    });

  const historySaveUserRateLimit =
    createSimpleRateLimit({
      windowMs: historyWriteWindowMs,
      maxAttempts:
        readPositiveIntegerEnv(
          "HISTORY_SAVE_RATE_MAX",
          30
        ),
      code:
        "HISTORY_SAVE_RATE_LIMITED",
      message:
        "\u5386\u53f2\u8bb0\u5f55\u4fdd\u5b58\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5",
      keyGenerator: (request) =>
        `user:${
          getAuthenticatedUser(request).id
        }`
    });

  const historySourceUserRateLimit =
    createSimpleRateLimit({
      windowMs: historyWriteWindowMs,
      maxAttempts:
        readPositiveIntegerEnv(
          "HISTORY_SOURCE_RATE_MAX",
          20
        ),
      code:
        "HISTORY_SOURCE_RATE_LIMITED",
      message:
        "\u539f\u59cb\u53c2\u8003\u7d20\u6750\u5f52\u6863\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5",
      keyGenerator: (request) =>
        `user:${
          getAuthenticatedUser(request).id
        }`
    });


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
    "/api/history/export-manifest",
    requireAuth,
    async (request, response) => {
      try {
        const user = getAuthenticatedUser(request);
        const history = await historyService.listAll(user.id);

        return response.json({
          history,
          total: history.length
        });
      } catch (error) {
        console.error("History export manifest error", error);
        return response.status(500).json({
          error: {
            code: "HISTORY_EXPORT_MANIFEST_ERROR",
            message: "读取导出数据失败"
          }
        });
      }
    }
  );

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

  router.post(
    "/api/history",
    requireAuth,
    historyWriteIpRateLimit,
    historySaveUserRateLimit,
    async (request, response) => {
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
      if (error instanceof HistoryStorageError) {
        return response.status(507).json({
          error: {
            code: "HISTORY_STORAGE_FULL",
            message: error.message
          }
        });
      }

      if (error instanceof HistoryValidationError) {
        return response.status(400).json({ error: { code: "INVALID_HISTORY_REQUEST", message: error.message } });
      }
      console.error("History save error", error);
      return response.status(502).json({
        error: { code: "HISTORY_SAVE_ERROR", message: error instanceof Error ? error.message : "图片保存到服务器失败" }
      });
    }
  });

  router.post(
    "/api/history/:id/source-images",
    requireAuth,
    historyWriteIpRateLimit,
    historySourceUserRateLimit,
    async (request, response) => {
      try {
        const user = getAuthenticatedUser(request);
        const historyId =
          readRouteParam(request.params.id);

        if (!historyId) {
          return response.status(400).json({
            error: {
              code: "INVALID_HISTORY_ID",
              message: "缺少历史记录 ID"
            }
          });
        }

        const images =
          parseHistorySourceImages(
            request.body?.images
          );

        const record =
          await historyService.saveSourceImages(
            historyId,
            user.id,
            images,
            {
              clientIp: request.ip,
              userAgent:
                request.get("user-agent"),
              ownerUsername:
                user.username
            }
          );

        return response.status(201).json({
          success: true,
          record
        });
      } catch (error) {
        if (
          error instanceof
          HistoryStorageError
        ) {
          return response.status(507).json({
            error: {
              code:
                "HISTORY_STORAGE_FULL",
              message:
                error.message
            }
          });
        }

        if (
          error instanceof
          HistoryValidationError
        ) {
          return response.status(400).json({
            error: {
              code:
                "INVALID_HISTORY_SOURCE_IMAGES",
              message:
                error.message
            }
          });
        }

        console.error(
          "History source image save error",
          error
        );

        return response.status(502).json({
          error: {
            code:
              "HISTORY_SOURCE_IMAGE_SAVE_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "原始参考素材保存失败"
          }
        });
      }
    }
  );

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

function readPositiveIntegerEnv(
  name: string,
  fallback: number
): number {
  const value =
    Number(process.env[name]);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return fallback;
  }

  return Math.trunc(value);
}
