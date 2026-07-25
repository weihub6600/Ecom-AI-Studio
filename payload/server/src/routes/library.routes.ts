import {
  Router,
  type RequestHandler
} from "express";
import {
  AuthError
} from "../auth.js";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import type {
  WorkLibraryBatchAction,
  WorkLibraryService,
  WorkLibrarySort
} from "../services/work-library.js";
import {
  readRouteParam,
  sendAuthError
} from "../utils/express.js";

export function createLibraryRouter(
  options: {
    workLibraryService:
      WorkLibraryService;
    requireAuth:
      RequestHandler;
  }
): Router {
  const {
    workLibraryService,
    requireAuth
  } = options;

  const router = Router();

  router.get(
    "/api/library",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const result =
          await workLibraryService.list(
            user.id,
            {
              page:
                readNumber(
                  request.query.page,
                  1
                ),
              pageSize:
                readNumber(
                  request.query.pageSize,
                  24
                ),
              search:
                readText(
                  request.query.search,
                  200
                ),
              folderId:
                readText(
                  request.query.folderId,
                  200
                ),
              tagId:
                readText(
                  request.query.tagId,
                  200
                ),
              provider:
                readText(
                  request.query.provider,
                  80
                ),
              favorite:
                readBoolean(
                  request.query.favorite
                ),
              trash:
                readBoolean(
                  request.query.trash
                ),
              sort:
                readSort(
                  request.query.sort
                )
            }
          );

        return response.json(result);
      } catch (error) {
        console.error(
          "Work library list error",
          error
        );

        return sendAuthError(
          response,
          error,
          "读取作品库失败"
        );
      }
    }
  );

  router.get(
    "/api/library/meta",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        return response.json(
          await workLibraryService.meta(
            user.id
          )
        );
      } catch (error) {
        console.error(
          "Work library metadata error",
          error
        );

        return sendAuthError(
          response,
          error,
          "读取作品库分类失败"
        );
      }
    }
  );

  router.post(
    "/api/library/folders",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const body =
          request.body as {
            name?: unknown
          };

        const folder =
          await workLibraryService
            .createFolder(
              user.id,
              body?.name
            );

        return response.status(201).json({
          folder
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "创建文件夹失败"
        );
      }
    }
  );

  router.patch(
    "/api/library/folders/:id",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const folderId =
          requireParam(
            request.params.id
          );

        const body =
          request.body as {
            name?: unknown
          };

        const folder =
          await workLibraryService
            .renameFolder(
              user.id,
              folderId,
              body?.name
            );

        return response.json({
          folder
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "重命名文件夹失败"
        );
      }
    }
  );

  router.delete(
    "/api/library/folders/:id",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        await workLibraryService
          .deleteFolder(
            user.id,
            requireParam(
              request.params.id
            )
          );

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除文件夹失败"
        );
      }
    }
  );

  router.post(
    "/api/library/tags",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const body =
          request.body as {
            name?: unknown
          };

        const tag =
          await workLibraryService
            .createTag(
              user.id,
              body?.name
            );

        return response.status(201).json({
          tag
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "创建标签失败"
        );
      }
    }
  );

  router.delete(
    "/api/library/tags/:id",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        await workLibraryService
          .deleteTag(
            user.id,
            requireParam(
              request.params.id
            )
          );

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除标签失败"
        );
      }
    }
  );

  router.patch(
    "/api/library/items/:id",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const body =
          asObject(request.body);

        const update: {
          favorite?: boolean;
          folderId?: string | null;
          note?: string | null;
          trashed?: boolean;
          tagIds?: string[];
        } = {};

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "favorite"
          )
        ) {
          update.favorite =
            body.favorite === true;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "folderId"
          )
        ) {
          update.folderId =
            typeof body.folderId ===
              "string"
              ? body.folderId
              : null;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "note"
          )
        ) {
          update.note =
            typeof body.note ===
              "string"
              ? body.note
              : null;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "trashed"
          )
        ) {
          update.trashed =
            body.trashed === true;
        }

        if (Array.isArray(body.tagIds)) {
          update.tagIds =
            body.tagIds.filter(
              (
                value
              ): value is string =>
                typeof value ===
                "string"
            );
        }

        const item =
          await workLibraryService
            .updateItem(
              user.id,
              requireParam(
                request.params.id
              ),
              update
            );

        return response.json({
          item
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "更新作品失败"
        );
      }
    }
  );

  router.post(
    "/api/library/batch",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const body =
          asObject(request.body);

        const changed =
          await workLibraryService.batch(
            user.id,
            {
              historyIds:
                readStringArray(
                  body.historyIds
                ),
              action:
                readBatchAction(
                  body.action
                ),
              folderId:
                typeof body.folderId ===
                  "string"
                  ? body.folderId
                  : body.folderId === null
                    ? null
                    : undefined,
              tagIds:
                readStringArray(
                  body.tagIds
                )
            }
          );

        return response.json({
          success: true,
          changed
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "批量整理作品失败"
        );
      }
    }
  );

  router.delete(
    "/api/library/trash",
    requireAuth,
    async (request, response) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const deleted =
          await workLibraryService
            .emptyTrash(user.id);

        return response.json({
          success: true,
          deleted
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "清空回收站失败"
        );
      }
    }
  );

  return router;
}

function requireParam(
  value: string | string[] | undefined
): string {
  const normalized =
    readRouteParam(value);

  if (!normalized) {
    throw new AuthError(
      400,
      "LIBRARY_INVALID_ID",
      "缺少资源 ID"
    );
  }

  return normalized;
}

function asObject(
  value: unknown
): Record<string, unknown> {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as
        Record<string, unknown>
    : {};
}

function readText(
  value: unknown,
  maximum: number
): string | undefined {
  return (
    typeof value === "string" &&
    value.trim()
  )
    ? value.trim().slice(
        0,
        maximum
      )
    : undefined;
}

function readNumber(
  value: unknown,
  fallback: number
): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function readBoolean(
  value: unknown
): boolean {
  return value === "true" ||
    value === "1";
}

function readSort(
  value: unknown
): WorkLibrarySort {
  return (
    value === "oldest" ||
    value === "updated" ||
    value === "favorite"
  )
    ? value
    : "newest";
}

function readStringArray(
  value: unknown
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (
          item
        ): item is string =>
          typeof item === "string"
      )
    : [];
}

function readBatchAction(
  value: unknown
): WorkLibraryBatchAction {
  if (
    value === "favorite" ||
    value === "unfavorite" ||
    value === "move" ||
    value === "add-tags" ||
    value === "remove-tags" ||
    value === "replace-tags" ||
    value === "trash" ||
    value === "restore"
  ) {
    return value;
  }

  throw new AuthError(
    400,
    "LIBRARY_INVALID_BATCH_ACTION",
    "批量操作不正确"
  );
}
