import {
  Router,
  type Request,
  type RequestHandler,
  type Response
} from "express";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import type {
  BatchJobService,
  BatchTemplateInput,
  CloneBatchInput,
  CreateBatchInput
} from "../services/batch-jobs.js";
import {
  readRouteParam,
  sendAuthError
} from "../utils/express.js";

export function createBatchRouter(options: {
  batchJobService:
    BatchJobService;
  requireAuth:
    RequestHandler;
}): Router {
  const {
    batchJobService,
    requireAuth
  } = options;

  const router = Router();

  router.get(
    "/api/batch-templates",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);

        return response.json({
          templates:
            await batchJobService
              .listTemplates(user.id)
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取商品模板失败"
        );
      }
    }
  );

  router.post(
    "/api/batch-templates",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const template =
          await batchJobService
            .createTemplate(
              user.id,
              request.body as
                BatchTemplateInput
            );

        return response
          .status(201)
          .json({ template });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "创建商品模板失败"
        );
      }
    }
  );

  router.patch(
    "/api/batch-templates/:id",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const templateId =
          requiredParam(
            request.params.id
          );
        const template =
          await batchJobService
            .updateTemplate(
              user.id,
              templateId,
              request.body as
                BatchTemplateInput
            );

        return response.json({
          template
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "更新商品模板失败"
        );
      }
    }
  );

  router.delete(
    "/api/batch-templates/:id",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const templateId =
          requiredParam(
            request.params.id
          );

        await batchJobService
          .deleteTemplate(
            user.id,
            templateId
          );

        return response.json({
          success: true
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "删除商品模板失败"
        );
      }
    }
  );

  router.post(
    "/api/batch-templates/:id/use",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const templateId =
          requiredParam(
            request.params.id
          );
        const template =
          await batchJobService
            .markTemplateUsed(
              user.id,
              templateId
            );

        return response.json({
          template
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "更新模板使用记录失败"
        );
      }
    }
  );

  router.get(
    "/api/batches",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const allUsers =
          user.role === "admin" &&
          request.query.scope === "all";

        return response.json({
          batches:
            await batchJobService.listJobs(
              user.id,
              allUsers
            )
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取批次列表失败"
        );
      }
    }
  );

  router.get(
    "/api/batches/:id",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const allUsers =
          user.role === "admin" &&
          request.query.scope === "all";
        const batchId =
          requiredParam(
            request.params.id
          );
        const batch =
          await batchJobService.readJob(
            user.id,
            batchId,
            allUsers
          );

        return response.json({
          batch
        });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "读取批次详情失败"
        );
      }
    }
  );

  router.post(
    "/api/batches",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const batch =
          await batchJobService.createJob(
            user.id,
            request.body as
              CreateBatchInput
          );

        return response
          .status(201)
          .json({ batch });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "创建批次失败"
        );
      }
    }
  );

  router.post(
    "/api/batches/:id/clone",
    requireAuth,
    async (request: Request, response: Response) => {
      try {
        const user =
          getAuthenticatedUser(request);
        const batchId =
          requiredParam(
            request.params.id
          );
        const batch =
          await batchJobService.cloneJob(
            user.id,
            batchId,
            request.body as
              CloneBatchInput
          );

        return response
          .status(201)
          .json({ batch });
      } catch (error) {
        return sendAuthError(
          response,
          error,
          "复制批次失败"
        );
      }
    }
  );

  for (const action of [
    "start",
    "pause",
    "resume",
    "retry",
    "cancel"
  ] as const) {
    router.post(
      `/api/batches/:id/${action}`,
      requireAuth,
      async (request: Request, response: Response) => {
        try {
          const user =
            getAuthenticatedUser(request);
          const allUsers =
            user.role === "admin" &&
            request.query.scope === "all";
          const batchId =
            requiredParam(
              request.params.id
            );

          const batch =
            action === "start"
              ? await batchJobService.startJob(
                  user.id,
                  batchId,
                  allUsers
                )
              : action === "pause"
                ? await batchJobService.pauseJob(
                    user.id,
                    batchId,
                    allUsers
                  )
                : action === "resume"
                  ? await batchJobService.resumeJob(
                      user.id,
                      batchId,
                      allUsers
                    )
                  : action === "retry"
                    ? await batchJobService.retryFailed(
                        user.id,
                        batchId,
                        allUsers
                      )
                    : await batchJobService.cancelJob(
                        user.id,
                        batchId,
                        allUsers
                      );

          return response.json({
            batch
          });
        } catch (error) {
          return sendAuthError(
            response,
            error,
            "更新批次状态失败"
          );
        }
      }
    );
  }

  return router;
}

function requiredParam(
  value:
    | string
    | string[]
    | undefined
): string {
  const result =
    readRouteParam(value);

  if (!result) {
    throw new Error(
      "缺少批次 ID"
    );
  }

  return result;
}
