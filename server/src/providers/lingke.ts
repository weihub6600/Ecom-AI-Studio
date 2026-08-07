import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProviderAdapter
} from "../types.js";
import {
  fetchWithTimeout,
  ProviderHttpError,
  readJsonResponse
} from "../utils/http.js";
import {
  getBuiltInModelRuntimeConfig,
  getBuiltInProviderRuntimeConfig
} from "../services/provider-runtime.js";

interface LingkeCreateResponse {
  code?: number;
  msg?: string;
  data?: {
    "对话组ID"?: string;
    "任务ids"?:
      Array<
        number |
        string
      >;
    task_id?:
      number |
      string;
  };
}

interface LingkeStatusResponse {
  state?: string;
  status?: string;
  status_group?: string;
  is_final?: boolean;
  progress?: string;
  result_url?: string;
  result_type?: string;
  error?: string;
  cost?: number;
}

function getConfig() {
  const runtime =
    getBuiltInProviderRuntimeConfig(
      "lingke"
    );

  const apiKey =
    runtime
      ? runtime.apiKey
      : (
          process.env
            .LINGKE_API_KEY ||
          ""
        );

  if (!apiKey) {
    throw new Error(
      "ZHE AI 尚未配置 API Key，或保存密钥与当前 API_PROVIDER_SECRET 不匹配"
    );
  }

  if (
    runtime &&
    !runtime.enabled
  ) {
    throw new Error(
      "ZHE AI 已由站长停用"
    );
  }

  return {
    displayName:
      runtime?.displayName ||
      "ZHE AI",
    apiKey,
    baseUrl:
      (
        runtime?.baseUrl ||
        process.env
          .LINGKE_BASE_URL ||
        "https://api.lk888.ai"
      ).replace(
        /\/+$/,
        ""
      ),
    generateEndpoint:
      runtime
        ?.generateEndpoint ||
      process.env
        .LINGKE_IMAGE_ENDPOINT ||
      "/v1/media/generate",
    statusEndpoint:
      runtime
        ?.statusEndpoint ||
      process.env
        .LINGKE_STATUS_ENDPOINT ||
      "/v1/media/status",
    timeoutMs:
      runtime?.timeoutMs ||
      300_000
  };
}

function apiModelFor(
  requestModel: string
): string {
  return (
    getBuiltInModelRuntimeConfig(
      "lingke",
      requestModel
    )?.apiModelId ||
    process.env
      .LINGKE_IMAGE_MODEL ||
    requestModel
  );
}

function normalizeTaskId(
  body:
    LingkeCreateResponse
):
  string |
  undefined {
  const value =
    body.data?.task_id ??
    body.data
      ?.["任务ids"]
      ?.[0];

  return (
    value === undefined ||
    value === null
  )
    ? undefined
    : String(value);
}

function isSuccessState(
  state?: string
): boolean {
  if (!state) return false;

  return [
    "success",
    "succeeded",
    "completed",
    "done",
    "已完成"
  ].includes(
    state.toLowerCase()
  );
}

function isFailedState(
  state?: string
): boolean {
  if (!state) return false;

  return [
    "failed",
    "failure",
    "error",
    "cancelled",
    "canceled",
    "失败",
    "已失败"
  ].includes(
    state.toLowerCase()
  );
}

export class LingkeAdapter
  implements ImageProviderAdapter {
  readonly provider =
    "lingke" as const;

  async generate(
    request:
      GenerateImageRequest
  ):
    Promise<
      GenerateImageResult
    > {
    const config =
      getConfig();

    const startedAt =
      Date.now();

    const response =
      await fetchWithTimeout(
        `${config.baseUrl}${config.generateEndpoint}`,
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${config.apiKey}`,
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              model:
                apiModelFor(
                  request.model
                ),
              prompt:
                request.prompt,
              params: {
                size:
                  request.size,
                images:
                  request.images.length >
                    0
                    ? request.images
                        .map(
                          (image) =>
                            image.dataUrl
                        )
                    : undefined,
                n:
                  request.count,
                quality:
                  request.quality ||
                  "high",
                resolution:
                  "1K",
                response_format:
                  "url",
                negative_prompt:
                  request.negativePrompt,
                seed:
                  request.seed
              }
            })
        },
        config.timeoutMs
      );

    const body =
      await readJsonResponse(
        response
      ) as
        LingkeCreateResponse;

    if (
      body.code !== undefined &&
      body.code !== 200
    ) {
      throw new ProviderHttpError(
        body.msg ||
        `${config.displayName} 返回业务错误 ${body.code}`,
        502,
        body
      );
    }

    const taskId =
      normalizeTaskId(body);

    if (!taskId) {
      throw new ProviderHttpError(
        body.msg ||
        "任务创建成功，但接口未返回 task_id",
        502,
        body
      );
    }

    return {
      provider:
        this.provider,
      model:
        request.model,
      images: [],
      durationMs:
        Date.now() -
        startedAt,
      requestId:
        body.data
          ?.["对话组ID"],
      taskId,
      status: "pending",
      progress: "0%"
    };
  }

  async getTask(
    taskId: string,
    model?: string
  ):
    Promise<
      GenerateImageResult
    > {
    const config =
      getConfig();

    const startedAt =
      Date.now();

    const statusUrl =
      new URL(
        `${config.baseUrl}${config.statusEndpoint}`
      );

    statusUrl.searchParams.set(
      "task_id",
      taskId
    );

    const response =
      await fetchWithTimeout(
        statusUrl.toString(),
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${config.apiKey}`,
            Accept:
              "application/json"
          }
        },
        Math.min(
          config.timeoutMs,
          60_000
        )
      );

    const body =
      await readJsonResponse(
        response
      ) as
        LingkeStatusResponse;

    const effectiveModel =
      model ||
      process.env
        .LINGKE_IMAGE_MODEL ||
      "gpt-image-2";

    const state =
      body.state ||
      body.status_group ||
      body.status;

    const errorMessage =
      body.error?.trim();

    if (!body.is_final) {
      return {
        provider:
          this.provider,
        model:
          effectiveModel,
        images: [],
        durationMs:
          Date.now() -
          startedAt,
        taskId,
        status:
          isFailedState(
            state
          ) ||
          Boolean(
            errorMessage
          )
            ? "failed"
            : "processing",
        progress:
          body.progress ||
          "处理中",
        cost:
          body.cost,
        error:
          errorMessage ||
          undefined
      };
    }

    if (
      isFailedState(state) ||
      errorMessage
    ) {
      return {
        provider:
          this.provider,
        model:
          effectiveModel,
        images: [],
        durationMs:
          Date.now() -
          startedAt,
        taskId,
        status: "failed",
        progress:
          body.progress ||
          "100%",
        cost:
          body.cost,
        error:
          errorMessage ||
          body.status ||
          body.state ||
          `${config.displayName} 任务执行失败`
      };
    }

    if (
      !isSuccessState(state) &&
      !body.result_url
    ) {
      return {
        provider:
          this.provider,
        model:
          effectiveModel,
        images: [],
        durationMs:
          Date.now() -
          startedAt,
        taskId,
        status: "failed",
        progress:
          body.progress ||
          "100%",
        cost:
          body.cost,
        error:
          `任务已结束，但状态不可识别：${state || "未知"}`
      };
    }

    if (!body.result_url) {
      return {
        provider:
          this.provider,
        model:
          effectiveModel,
        images: [],
        durationMs:
          Date.now() -
          startedAt,
        taskId,
        status: "failed",
        progress:
          body.progress ||
          "100%",
        cost:
          body.cost,
        error:
          "任务已完成，但未返回 result_url"
      };
    }

    return {
      provider:
        this.provider,
      model:
        effectiveModel,
      images: [
        {
          url:
            body.result_url,
          mimeType:
            body.result_type ===
              "image"
              ? "image/png"
              : undefined
        }
      ],
      durationMs:
        Date.now() -
        startedAt,
      taskId,
      status: "completed",
      progress:
        body.progress ||
        "100%",
      cost:
        body.cost
    };
  }
}
