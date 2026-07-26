import {
  Router,
  type RequestHandler
} from "express";
import type {
  CustomProviderService
} from "../services/custom-providers.js";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import {
  readRouteParam,
  sendAuthError
} from "../utils/express.js";

export function createCustomProviderRouter(
  options: {
    customProviderService:
      CustomProviderService;
    requireAuth:
      RequestHandler;
    requireAdmin:
      RequestHandler;
  }
): Router {
  const router =
    Router();

  const {
    customProviderService,
    requireAuth,
    requireAdmin
  } = options;

  router.use(
    "/api/admin/api-providers",
    requireAuth,
    requireAdmin
  );

  router.get(
    "/api/admin/api-providers",
    async (
      _request,
      response
    ) => {
      try {
        return response.json({
          providers:
            await customProviderService
              .listAdmin()
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "读取 API 服务商失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/api-providers",
    async (
      request,
      response
    ) => {
      try {
        const user =
          getAuthenticatedUser(
            request
          );

        const provider =
          await customProviderService
            .createProvider(
              asRecord(
                request.body
              ),
              user.id
            );

        return response
          .status(201)
          .json({
            provider
          });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "新增 API 服务商失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/api-providers/:providerId",
    async (
      request,
      response
    ) => {
      try {
        const providerId =
          readRouteParam(
            request.params
              .providerId
          );

        if (!providerId) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_PROVIDER_ID",
                message:
                  "缺少服务商标识"
              }
            });
        }

        return response.json({
          provider:
            await customProviderService
              .updateProvider(
                providerId,
                asRecord(
                  request.body
                )
              )
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "更新 API 服务商失败"
        );
      }
    }
  );

  router.delete(
    "/api/admin/api-providers/:providerId",
    async (
      request,
      response
    ) => {
      try {
        const providerId =
          readRouteParam(
            request.params
              .providerId
          );

        if (!providerId) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_PROVIDER_ID",
                message:
                  "缺少服务商标识"
              }
            });
        }

        await customProviderService
          .deleteProvider(
            providerId
          );

        return response.json({
          success: true
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "删除 API 服务商失败"
        );
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/models",
    async (
      request,
      response
    ) => {
      try {
        const providerId =
          readRouteParam(
            request.params
              .providerId
          );

        if (!providerId) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_PROVIDER_ID",
                message:
                  "缺少服务商标识"
              }
            });
        }

        return response
          .status(201)
          .json({
            model:
              await customProviderService
                .createModel(
                  providerId,
                  asRecord(
                    request.body
                  )
                )
          });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "新增模型失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/api-providers/:providerId/models/:modelId",
    async (
      request,
      response
    ) => {
      try {
        const providerId =
          readRouteParam(
            request.params
              .providerId
          );

        const modelId =
          readRouteParam(
            request.params
              .modelId
          );

        if (
          !providerId ||
          !modelId
        ) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_MODEL_ID",
                message:
                  "缺少服务商或模型标识"
              }
            });
        }

        return response.json({
          model:
            await customProviderService
              .updateModel(
                providerId,
                modelId,
                asRecord(
                  request.body
                )
              )
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "更新模型失败"
        );
      }
    }
  );

  router.delete(
    "/api/admin/api-providers/:providerId/models/:modelId",
    async (
      request,
      response
    ) => {
      try {
        const providerId =
          readRouteParam(
            request.params
              .providerId
          );

        const modelId =
          readRouteParam(
            request.params
              .modelId
          );

        if (
          !providerId ||
          !modelId
        ) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_MODEL_ID",
                message:
                  "缺少服务商或模型标识"
              }
            });
        }

        await customProviderService
          .deleteModel(
            providerId,
            modelId
          );

        return response.json({
          success: true
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "删除模型失败"
        );
      }
    }
  );

  return router;
}

function asRecord(
  value: unknown
):
  Record<
    string,
    unknown
  > {
  return (
    value &&
    typeof value === "object"
  )
    ? value as Record<
        string,
        unknown
      >
    : {};
}
