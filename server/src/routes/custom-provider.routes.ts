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
    customProviderService: CustomProviderService;
    builtInProviderSettingsService: BuiltInProviderSettingsService;
    modelSettingsService: ModelSettingsService;
    requireAuth: RequestHandler;
    requireAdmin: RequestHandler;
  }
): Router {
  const router = Router();
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

  // -----------------------------
  // 专用适配器兼容层（保持原接口）
  // -----------------------------
  router.get(
    "/api/admin/builtin-api-providers",
    async (_request, response) => {
      try {
        return response.json({
          providers: await builtInProviderSettingsService.listAdmin(),
          security: builtInProviderSettingsService.getSecurityStatus(),
          models: modelSettingsService
            .listAll()
            .filter((item) => isBuiltInProviderId(item.provider))
            .map(serializeBuiltInModel)
        });
      } catch (error) {
        return sendAuthError(response, error, "读取内置 API 服务商失败");
      }
    }
  );

  router.patch(
    "/api/admin/builtin-api-providers/:providerId",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        if (!providerId) return;

        const actor = getAuthenticatedUser(request);
        const provider = await builtInProviderSettingsService.update(
          providerId,
          asRecord(request.body),
          actor.id
        );
        await modelSettingsService.reload();

        return response.json({
          provider,
          security: builtInProviderSettingsService.getSecurityStatus(),
          models: modelSettingsService
            .listAll()
            .filter((item) => item.provider === providerId)
            .map(serializeBuiltInModel)
        });
      } catch (error) {
        return sendAuthError(response, error, "更新内置 API 服务商失败");
      }
    }
  );

  router.patch(
    "/api/admin/builtin-api-providers/:providerId/models/:modelId",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        if (!isBuiltInProviderId(providerId)) {
          return response.status(400).json({
            error: {
              code: "INVALID_PROVIDER_ID",
              message: "该服务商不是专用适配器"
            }
          });
        }

        const actor = getAuthenticatedUser(request);
        const model = await modelSettingsService.update(
          providerId,
          modelId,
          asRecord(request.body),
          actor.id
        );

        return response.json({ model: serializeBuiltInModel(model) });
      } catch (error) {
        return sendAuthError(response, error, "更新内置模型失败");
      }
    }
  );

  // -----------------------------
  // V14 通用 Provider Registry
  // -----------------------------
  router.get(
    "/api/admin/api-providers",
    async (_request, response) => {
      try {
        return response.json({
          providers: await customProviderService.listAdmin(),
          variables: [
            "model",
            "api_model_id",
            "prompt",
            "negative_prompt",
            "size",
            "original_size",
            "width",
            "height",
            "count",
            "quality",
            "seed",
            "operation",
            "reference_images",
            "reference_image_1",
            "reference_image_2",
            "task_id"
          ]
        });
      } catch (error) {
        return sendAuthError(response, error, "读取 API 服务商失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers",
    async (request, response) => {
      try {
        const user = getAuthenticatedUser(request);
        const provider = await customProviderService.createProvider(
          asRecord(request.body),
          user.id
        );
        return response.status(201).json({ provider });
      } catch (error) {
        return sendAuthError(response, error, "新增 API 服务商失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/clone",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        if (!providerId) return;

        const user = getAuthenticatedUser(request);
        const provider = await customProviderService.cloneProvider(
          providerId,
          asRecord(request.body),
          user.id
        );

        return response.status(201).json({ provider });
      } catch (error) {
        return sendAuthError(response, error, "复制 API 服务商失败");
      }
    }
  );

  router.patch(
    "/api/admin/api-providers/:providerId",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        if (!providerId) return;

        return response.json({
          provider: await customProviderService.updateProvider(
            providerId,
            asRecord(request.body)
          )
        });
      } catch (error) {
        return sendAuthError(response, error, "更新 API 服务商失败");
      }
    }
  );

  router.delete(
    "/api/admin/api-providers/:providerId",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        if (!providerId) return;
        await customProviderService.deleteProvider(providerId);
        return response.json({ success: true });
      } catch (error) {
        return sendAuthError(response, error, "删除 API 服务商失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/models",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        if (!providerId) return;
        return response.status(201).json({
          model: await customProviderService.createModel(
            providerId,
            asRecord(request.body)
          )
        });
      } catch (error) {
        return sendAuthError(response, error, "新增模型失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/models/:modelId/clone",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        return response.status(201).json({
          model: await customProviderService.cloneModel(
            providerId,
            modelId,
            asRecord(request.body)
          )
        });
      } catch (error) {
        return sendAuthError(response, error, "复制模型失败");
      }
    }
  );

  router.patch(
    "/api/admin/api-providers/:providerId/models/:modelId",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        return response.json({
          model: await customProviderService.updateModel(
            providerId,
            modelId,
            asRecord(request.body)
          )
        });
      } catch (error) {
        return sendAuthError(response, error, "更新模型失败");
      }
    }
  );

  router.delete(
    "/api/admin/api-providers/:providerId/models/:modelId",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        await customProviderService.deleteModel(providerId, modelId);
        return response.json({ success: true });
      } catch (error) {
        return sendAuthError(response, error, "删除模型失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/models/:modelId/preview",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        return response.json({
          preview: await customProviderService.previewRequest(
            providerId,
            modelId,
            asRecord(request.body)
          )
        });
      } catch (error) {
        return sendAuthError(response, error, "生成请求预览失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/models/:modelId/test",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        const result = await customProviderService.testModel(
          providerId,
          modelId,
          asRecord(request.body)
        );
        return response.json({ result });
      } catch (error) {
        return sendAuthError(response, error, "测试模型 API 失败");
      }
    }
  );

  router.post(
    "/api/admin/api-providers/:providerId/models/:modelId/test-status",
    async (request, response) => {
      try {
        const providerId = requireParam(
          request.params.providerId,
          response,
          "INVALID_PROVIDER_ID",
          "缺少服务商标识"
        );
        const modelId = requireParam(
          request.params.modelId,
          response,
          "INVALID_MODEL_ID",
          "缺少模型标识"
        );
        if (!providerId || !modelId) return;

        const body = asRecord(request.body);
        const taskId =
          typeof body.taskId === "string"
            ? body.taskId.trim()
            : "";

        if (!taskId) {
          return response.status(400).json({
            error: {
              code: "INVALID_TASK_ID",
              message: "缺少异步测试任务 ID"
            }
          });
        }

        const result = await customProviderService.testTask(
          providerId,
          modelId,
          taskId
        );

        return response.json({ result });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "查询模型测试任务失败"
        );
      }
    }
  );


  return router;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function requireParam(
  value: string | string[] | undefined,
  response: import("express").Response,
  code: string,
  message: string
): string | undefined {
  const id = readRouteParam(value);
  if (!id) {
    response.status(400).json({ error: { code, message } });
    return undefined;
  }
  return id;
}

function serializeBuiltInModel(
  item: ReturnType<ModelSettingsService["listAll"]>[number]
) {
  return {
    provider: item.provider,
    model: item.model,
    apiModelId: item.apiModelId,
    name: item.name,
    providerName: item.providerName,
    enabled: item.enabled,
    points: item.points,
    configured: item.configured,
    description: item.capability.description,
    sortOrder: item.sortOrder,
    sizes: item.capability.sizes,
    qualities: item.capability.qualities,
    maxOutputImages: item.capability.maxOutputImages,
    supportsReferenceImages: item.capability.supportsReferenceImages,
    maxReferenceImages: item.capability.maxReferenceImages,
    supportsNegativePrompt: item.capability.supportsNegativePrompt,
    supportsSeed: item.capability.supportsSeed,
    asynchronous: Boolean(item.capability.asynchronous),
    updatedAt: item.updatedAt
  };
}
