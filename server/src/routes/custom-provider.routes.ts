import {
  Router,
  type RequestHandler
} from "express";
import type {
  CustomProviderService
} from "../services/custom-providers.js";
import type {
  BuiltInProviderSettingsService
} from "../services/builtin-provider-settings.js";
import type {
  ModelSettingsService
} from "../services/model-settings.js";
import {
  isBuiltInProviderId
} from "../services/provider-runtime.js";
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
    builtInProviderSettingsService:
      BuiltInProviderSettingsService;
    modelSettingsService:
      ModelSettingsService;
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
    builtInProviderSettingsService,
    modelSettingsService,
    requireAuth,
    requireAdmin
  } = options;

  router.use(
    "/api/admin",
    requireAuth,
    requireAdmin
  );

  router.get(
    "/api/admin/builtin-api-providers",
    async (
      _request,
      response
    ) => {
      try {
        return response.json({
          providers:
            await builtInProviderSettingsService
              .listAdmin(),
          models:
            modelSettingsService
              .listAll()
              .filter(
                (item) =>
                  isBuiltInProviderId(
                    item.provider
                  )
              )
              .map(
                serializeBuiltInModel
              )
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "读取内置 API 服务商失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/builtin-api-providers/:providerId",
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

        const actor =
          getAuthenticatedUser(
            request
          );

        const provider =
          await builtInProviderSettingsService
            .update(
              providerId,
              asRecord(
                request.body
              ),
              actor.id
            );

        await modelSettingsService
          .reload();

        return response.json({
          provider,
          models:
            modelSettingsService
              .listAll()
              .filter(
                (item) =>
                  item.provider ===
                  providerId
              )
              .map(
                serializeBuiltInModel
              )
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "更新内置 API 服务商失败"
        );
      }
    }
  );

  router.patch(
    "/api/admin/builtin-api-providers/:providerId/models/:modelId",
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

        if (
          !isBuiltInProviderId(
            providerId
          )
        ) {
          return response
            .status(400)
            .json({
              error: {
                code:
                  "INVALID_PROVIDER_ID",
                message:
                  "该服务商不是内置专用适配器"
              }
            });
        }

        const actor =
          getAuthenticatedUser(
            request
          );

        const model =
          await modelSettingsService
            .update(
              providerId,
              modelId,
              asRecord(
                request.body
              ),
              actor.id
            );

        return response.json({
          model:
            serializeBuiltInModel(
              model
            )
        });
      }
      catch (error) {
        return sendAuthError(
          response,
          error,
          "更新内置模型失败"
        );
      }
    }
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


function serializeBuiltInModel(
  item: ReturnType<
    ModelSettingsService[
      "listAll"
    ]
  >[number]
) {
  return {
    provider:
      item.provider,
    model:
      item.model,
    apiModelId:
      item.apiModelId,
    name:
      item.name,
    providerName:
      item.providerName,
    enabled:
      item.enabled,
    points:
      item.points,
    configured:
      item.configured,
    description:
      item.capability
        .description,
    sizes:
      item.capability.sizes,
    maxOutputImages:
      item.capability
        .maxOutputImages,
    supportsReferenceImages:
      item.capability
        .supportsReferenceImages,
    maxReferenceImages:
      item.capability
        .maxReferenceImages,
    supportsNegativePrompt:
      item.capability
        .supportsNegativePrompt,
    supportsSeed:
      item.capability
        .supportsSeed,
    asynchronous:
      Boolean(
        item.capability
          .asynchronous
      ),
    updatedAt:
      item.updatedAt
  };
}
