param(
    [string]$ProjectRoot = "E:\Code\Ecom-AI-Studio"
)

$ErrorActionPreference = "Stop"
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $ProjectRoot ".v11-backup-$Timestamp"

$Files = @(
    ".env.example",
    ".gitignore",
    "package.json",
    "server\src\app\context.ts",
    "server\src\app\create-app.ts",
    "server\src\middleware\rate-limit.ts",
    "server\src\routes\generation.routes.ts",
    "server\src\routes\system.routes.ts",
    "server\src\server.ts",
    "server\src\services\generation-guard.ts",
    "server\src\services\health.ts",
    "scripts\backup-mysql.ps1",
    "scripts\health-check.ps1",
    "scripts\check-sensitive-files.ps1",
    "scripts\install-git-hooks.ps1",
    "docs\V11-运维说明.md"
)

$OriginalState = @{}

function Write-Utf8File {
    param(
        [string]$Path,
        [string]$Content
    )

    $Parent = Split-Path $Path -Parent

    if ($Parent) {
        New-Item `
            -ItemType Directory `
            -Path $Parent `
            -Force |
            Out-Null
    }

    [System.IO.File]::WriteAllText(
        $Path,
        $Content.Replace("`r`n", "`n").Replace("`r", "`n"),
        $Utf8NoBom
    )
}

function Backup-ProjectFiles {
    New-Item `
        -ItemType Directory `
        -Path $BackupRoot `
        -Force |
        Out-Null

    foreach ($RelativePath in $Files) {
        $Source = Join-Path $ProjectRoot $RelativePath
        $Exists = Test-Path -LiteralPath $Source -PathType Leaf

        $OriginalState[$RelativePath] = $Exists

        if (-not $Exists) {
            continue
        }

        $Destination = Join-Path $BackupRoot $RelativePath
        $Parent = Split-Path $Destination -Parent

        New-Item `
            -ItemType Directory `
            -Path $Parent `
            -Force |
            Out-Null

        Copy-Item `
            -LiteralPath $Source `
            -Destination $Destination `
            -Force
    }
}

function Restore-ProjectFiles {
    foreach ($RelativePath in $Files) {
        $Destination = Join-Path $ProjectRoot $RelativePath
        $BackupFile = Join-Path $BackupRoot $RelativePath

        if (
            $OriginalState[$RelativePath] -eq $true -and
            (Test-Path -LiteralPath $BackupFile)
        ) {
            $Parent = Split-Path $Destination -Parent

            New-Item `
                -ItemType Directory `
                -Path $Parent `
                -Force |
                Out-Null

            Copy-Item `
                -LiteralPath $BackupFile `
                -Destination $Destination `
                -Force
        }
        elseif ($OriginalState[$RelativePath] -eq $false) {
            Remove-Item `
                -LiteralPath $Destination `
                -Force `
                -ErrorAction SilentlyContinue
        }
    }
}

try {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " Ecom AI Studio V11 中文安装程序" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
        throw "没有找到项目：$ProjectRoot"
    }

    if (
        -not (
            Test-Path (
                Join-Path $ProjectRoot `
                "server\src\services\model-settings.ts"
            )
        )
    ) {
        throw "当前项目不是预期的 V10 版本，已停止安装。"
    }

    Write-Host "正在备份 V10 文件……" -ForegroundColor Yellow
    Backup-ProjectFiles

    # ============================================================
    # .env.example
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot ".env.example") `
@'
# 服务端
PORT=8787
REQUEST_TIMEOUT_MS=180000

# MySQL
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=ecom_ai_studio
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_CONNECTION_LIMIT=10
MYSQL_AUTO_CREATE_DATABASE=true
MYSQL_MIGRATE_JSON=true
MYSQL_SSL=false

# 用户登录
ADMIN_USERNAME=admin
AUTH_SESSION_TTL_SECONDS=2592000
AUTH_COOKIE_SECURE=false

# V11 生图限流与并发保护
# 在指定时间窗口内，每个用户最多提交多少次生图请求
GENERATION_RATE_WINDOW_MS=60000
GENERATION_RATE_MAX_REQUESTS=8

# 全站同时调用模型接口的最大请求数
GENERATION_MAX_CONCURRENT=4

# 每个用户同时允许执行的生图请求数
GENERATION_MAX_PER_USER=1

# V11 健康检查磁盘预警阈值
HEALTH_DISK_WARNING_PERCENT=85
HEALTH_DISK_CRITICAL_PERCENT=95

# MySQL 备份保留天数
BACKUP_RETENTION_DAYS=14

# 百嘉瑞AI / GPT Image 2
LINGKE_API_KEY=
LINGKE_BASE_URL=https://api.lk888.ai
LINGKE_IMAGE_ENDPOINT=/v1/media/generate
LINGKE_STATUS_ENDPOINT=/v1/media/status
LINGKE_IMAGE_MODEL=gpt-image-2

# GPT / GPT Image 2
GRSAI_API_KEY=
GRSAI_BASE_URL=https://grsai.dakka.com.cn
GRSAI_IMAGE_ENDPOINT=/v1/api/generate
GRSAI_DEFAULT_MODEL=gpt-image-2
GRSAI_TIMEOUT_MS=300000

# 生成图片存储
IMAGE_STORAGE_DIR=data
IMAGE_HISTORY_LIMIT=0
IMAGE_MAX_DOWNLOAD_BYTES=41943040
IMAGE_DOWNLOAD_TIMEOUT_MS=120000

# Nano Banana
NANO_BANANA_API_KEY=
NANO_BANANA_BASE_URL=https://grsai.dakka.com.cn
NANO_BANANA_IMAGE_ENDPOINT=/v1/api/generate
NANO_BANANA_IMAGE_SIZE=4K
NANO_BANANA_TIMEOUT_MS=300000
'@

    # ============================================================
    # .gitignore
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot ".gitignore") `
@'
node_modules/
dist/
*.log

.env
.env.local
.env.*.local
!.env.example

data/
backups/
logs/

*.sql
*.sql.gz
*.dump
*.pem
*.key
*.pfx
*.p12

.DS_Store
.vscode/
.idea/

.v*-backup-*/
.server-history-backup-*/
.history-backup-*/
Ecom-AI-Studio-server-history-patch-*/
'@

    # ============================================================
    # package.json
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "package.json") `
@'
{
  "name": "ecom-ai-studio",
  "private": true,
  "version": "0.1.0",
  "workspaces": [
    "web",
    "server"
  ],
  "scripts": {
    "dev": "concurrently -k -n API,WEB -c auto \"npm run dev -w server\" \"npm run dev -w web\"",
    "build": "npm run build -w web && npm run build -w server",
    "start": "node server/dist/index.js",
    "health": "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\health-check.ps1",
    "backup:mysql": "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\backup-mysql.ps1",
    "security:check": "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\check-sensitive-files.ps1",
    "hooks:install": "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install-git-hooks.ps1"
  },
  "devDependencies": {
    "concurrently": "^9.2.1"
  },
  "engines": {
    "node": ">=20.19.0"
  }
}
'@

    # ============================================================
    # server/src/app/context.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\app\context.ts") `
@'
import type { AppDatabase } from "../db/database.js";
import type { AuthService } from "../auth.js";
import type { HistoryService } from "../history.js";
import type { ModelSettingsService } from "../services/model-settings.js";
import type { AuditLogService } from "../services/audit-log.js";
import type { AdminQueryService } from "../services/admin-query.js";
import type { HealthService } from "../services/health.js";

export interface AppContext {
  database: AppDatabase;
  authService: AuthService;
  historyService: HistoryService;
  modelSettingsService: ModelSettingsService;
  auditLogService: AuditLogService;
  adminQueryService: AdminQueryService;
  healthService: HealthService;
  secureAuthCookie: boolean;
  webDist: string;
}
'@

    # ============================================================
    # server/src/app/create-app.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\app\create-app.ts") `
@'
import express, { type Express } from "express";
import path from "node:path";
import type { AppContext } from "./context.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createSystemRouter } from "../routes/system.routes.js";
import { createAuthRouter } from "../routes/auth.routes.js";
import { createAccountRouter } from "../routes/account.routes.js";
import { createAdminRouter } from "../routes/admin.routes.js";
import { createHistoryRouter } from "../routes/history.routes.js";
import { createGenerationRouter } from "../routes/generation.routes.js";

export function createApp(context: AppContext): Express {
  const app = express();

  const {
    requireAuth,
    requireAdmin
  } = createAuthMiddleware(context.authService);

  app.disable("x-powered-by");

  app.use(express.json({
    limit: "120mb"
  }));

  app.use((_request, response, next) => {
    response.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    response.setHeader(
      "X-Frame-Options",
      "DENY"
    );

    response.setHeader(
      "Referrer-Policy",
      "same-origin"
    );

    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );

    next();
  });

  app.use(createSystemRouter({
    modelSettingsService: context.modelSettingsService,
    healthService: context.healthService
  }));

  app.use(createAuthRouter({
    authService: context.authService,
    secureAuthCookie: context.secureAuthCookie
  }));

  app.use(createAccountRouter({
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
    requireAuth
  }));

  app.use(createAdminRouter({
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
    auditLogService: context.auditLogService,
    adminQueryService: context.adminQueryService,
    requireAuth,
    requireAdmin
  }));

  app.use(createHistoryRouter({
    historyService: context.historyService,
    requireAuth
  }));

  app.use(createGenerationRouter({
    authService: context.authService,
    modelSettingsService: context.modelSettingsService,
    requireAuth
  }));

  app.use(express.static(context.webDist));

  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/")) {
      return next();
    }

    response.sendFile(
      path.join(context.webDist, "index.html"),
      (error) => {
        if (error) next();
      }
    );
  });

  return app;
}
'@

    # ============================================================
    # server/src/middleware/rate-limit.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\middleware\rate-limit.ts") `
@'
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response
} from "express";

export interface RateLimitOptions {
  windowMs: number;
  maxAttempts: number;
  code?: string;
  message?: string;
  keyGenerator?: (request: Request) => string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function createSimpleRateLimit(
  options: RateLimitOptions
): RequestHandler {
  const windowMs = positiveInteger(
    options.windowMs,
    60_000
  );

  const maxAttempts = positiveInteger(
    options.maxAttempts,
    20
  );

  const buckets = new Map<string, RateLimitBucket>();
  let cleanupCounter = 0;

  return (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    const now = Date.now();

    const key =
      options.keyGenerator?.(request) ||
      request.ip ||
      request.socket.remoteAddress ||
      "unknown";

    const current = buckets.get(key);

    response.setHeader(
      "X-RateLimit-Limit",
      String(maxAttempts)
    );

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs
      });

      response.setHeader(
        "X-RateLimit-Remaining",
        String(Math.max(0, maxAttempts - 1))
      );

      next();
      return;
    }

    if (current.count >= maxAttempts) {
      const retryAfter = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000)
      );

      response.setHeader(
        "Retry-After",
        String(retryAfter)
      );

      response.setHeader(
        "X-RateLimit-Remaining",
        "0"
      );

      response.status(429).json({
        error: {
          code:
            options.code ||
            "TOO_MANY_REQUESTS",
          message:
            options.message ||
            "请求过于频繁，请稍后再试"
        }
      });

      return;
    }

    current.count += 1;

    response.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxAttempts - current.count))
    );

    cleanupCounter += 1;

    if (
      cleanupCounter >= 1000 ||
      buckets.size > 10_000
    ) {
      cleanupCounter = 0;

      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}

function positiveInteger(
  value: number,
  fallback: number
): number {
  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}
'@

    # ============================================================
    # server/src/services/generation-guard.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\services\generation-guard.ts") `
@'
import { AuthError } from "../auth/contracts.js";

export interface GenerationGuardOptions {
  maxConcurrent: number;
  maxPerUser: number;
}

export function createGenerationGuard(
  options: GenerationGuardOptions
) {
  const maxConcurrent = positiveInteger(
    options.maxConcurrent,
    4
  );

  const maxPerUser = positiveInteger(
    options.maxPerUser,
    1
  );

  let activeTotal = 0;

  const activeByUser =
    new Map<string, number>();

  function acquire(userId: string): () => void {
    const currentUserCount =
      activeByUser.get(userId) || 0;

    if (currentUserCount >= maxPerUser) {
      throw new AuthError(
        429,
        "USER_GENERATION_BUSY",
        "当前账号已有生图请求正在提交，请等待本次请求完成"
      );
    }

    if (activeTotal >= maxConcurrent) {
      throw new AuthError(
        429,
        "GENERATION_CAPACITY_FULL",
        "当前生图请求较多，请稍后再试"
      );
    }

    activeTotal += 1;

    activeByUser.set(
      userId,
      currentUserCount + 1
    );

    let released = false;

    return () => {
      if (released) return;

      released = true;
      activeTotal = Math.max(0, activeTotal - 1);

      const nextCount = Math.max(
        0,
        (activeByUser.get(userId) || 1) - 1
      );

      if (nextCount === 0) {
        activeByUser.delete(userId);
      }
      else {
        activeByUser.set(userId, nextCount);
      }
    };
  }

  function snapshot() {
    return {
      activeTotal,
      activeUsers: activeByUser.size,
      maxConcurrent,
      maxPerUser
    };
  }

  return {
    acquire,
    snapshot
  };
}

function positiveInteger(
  value: number,
  fallback: number
): number {
  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

export type GenerationGuard =
  ReturnType<typeof createGenerationGuard>;
'@

    # ============================================================
    # server/src/routes/generation.routes.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\routes\generation.routes.ts") `
@'
import {
  Router,
  type RequestHandler,
  type Response
} from "express";
import { ZodError } from "zod";
import {
  AuthError,
  type AuthService,
  type GenerationReservation,
  type UsageRecordInput
} from "../auth.js";
import { validateModelSize } from "../models.js";
import {
  calculateGenerationCreditCost
} from "../pricing.js";
import type {
  ModelSettingsService
} from "../services/model-settings.js";
import {
  generateImage,
  getImageTask
} from "../router.js";
import type { ProviderId } from "../types.js";
import {
  ProviderHttpError
} from "../utils/http.js";
import { generateSchema } from "../validation.js";
import {
  getAuthenticatedUser
} from "../middleware/auth.js";
import {
  createSimpleRateLimit
} from "../middleware/rate-limit.js";
import {
  createGenerationGuard
} from "../services/generation-guard.js";
import {
  readRouteParam,
  sendAuthError
} from "../utils/express.js";

export function createGenerationRouter(options: {
  authService: AuthService;
  modelSettingsService: ModelSettingsService;
  requireAuth: RequestHandler;
}): Router {
  const {
    authService,
    modelSettingsService,
    requireAuth
  } = options;

  const router = Router();

  const generationGuard = createGenerationGuard({
    maxConcurrent: readPositiveEnv(
      "GENERATION_MAX_CONCURRENT",
      4
    ),
    maxPerUser: readPositiveEnv(
      "GENERATION_MAX_PER_USER",
      1
    )
  });

  const generationRateLimit = createSimpleRateLimit({
    windowMs: readPositiveEnv(
      "GENERATION_RATE_WINDOW_MS",
      60_000
    ),
    maxAttempts: readPositiveEnv(
      "GENERATION_RATE_MAX_REQUESTS",
      8
    ),
    code: "GENERATION_RATE_LIMITED",
    message: "生图请求过于频繁，请稍后再试",
    keyGenerator: (request) => {
      try {
        return getAuthenticatedUser(request).id;
      }
      catch {
        return (
          request.ip ||
          request.socket.remoteAddress ||
          "unknown"
        );
      }
    }
  });

  router.post(
    "/api/images/generate",
    requireAuth,
    generationRateLimit,
    async (request, response) => {
      const user = getAuthenticatedUser(request);

      let usageInput =
        buildUsageInputFromRawRequest(
          request.body,
          user.id
        );

      let reservation:
        GenerationReservation | undefined;

      let releaseGeneration:
        (() => void) | undefined;

      try {
        const input =
          generateSchema.parse(request.body);

        const runtimeModel =
          modelSettingsService.get(
            input.provider,
            input.model
          );

        const model =
          runtimeModel?.capability;

        usageInput = {
          ...usageInput,
          provider: input.provider,
          model: input.model,
          operation:
            input.images.length > 0
              ? "image-edit"
              : "text-to-image",
          size: input.size,
          imageCount: input.count
        };

        if (!model || !runtimeModel) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "MODEL_NOT_FOUND",
            "模型不存在或尚未注册"
          );
        }

        if (!runtimeModel.enabled) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "MODEL_DISABLED",
            "该模型已由站长暂停使用"
          );
        }

        if (model.provider !== input.provider) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "MODEL_PROVIDER_MISMATCH",
            "模型与 API 服务商不匹配"
          );
        }

        if (!model.configured) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "PROVIDER_NOT_CONFIGURED",
            `${model.providerName} 尚未配置 API Key`
          );
        }

        if (
          input.images.length >
          model.maxReferenceImages
        ) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "TOO_MANY_IMAGES",
            `该模型最多支持 ${model.maxReferenceImages} 张参考图`
          );
        }

        if (
          input.count >
          model.maxOutputImages
        ) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "TOO_MANY_OUTPUTS",
            `该模型单次最多生成 ${model.maxOutputImages} 张图片`
          );
        }

        const sizeError =
          validateModelSize(
            model,
            input.size
          );

        if (sizeError) {
          return await rejectGeneration(
            authService,
            response,
            usageInput,
            "INVALID_SIZE",
            sizeError
          );
        }

        releaseGeneration =
          generationGuard.acquire(user.id);

        reservation =
          await authService.reserveGenerationCredits(
            user.id,
            calculateGenerationCreditCost(
              runtimeModel.points,
              input.count
            ),
            model.providerName,
            model.name
          );

        const result =
          await generateImage(input);

        const isPending =
          result.status === "pending" ||
          result.status === "processing";

        if (isPending) {
          await safeRecordUsage(
            authService,
            {
              ...usageInput,
              imageCount: input.count,
              status: "submitted",
              durationMs: result.durationMs,
              cost: result.cost,
              requestId:
                result.requestId ||
                result.taskId,
              operationId:
                reservation.operationId,
              pointsCost:
                reservation.pointsCost
            }
          );

          return response.json({
            success: true,
            result,
            credits: reservation.balance,
            pointsCost:
              reservation.pointsCost
          });
        }

        const actualImageCount =
          result.images.length;

        if (actualImageCount < 1) {
          throw new Error(
            "服务端未返回生成图片"
          );
        }

        const settlement =
          await authService.settleGenerationCredits(
            user.id,
            reservation.operationId,
            calculateGenerationCreditCost(
              runtimeModel.points,
              actualImageCount
            ),
            "按实际成功生成图片数量结算"
          );

        await safeRecordUsage(
          authService,
          {
            ...usageInput,
            imageCount: actualImageCount,
            status: "success",
            durationMs: result.durationMs,
            cost: result.cost,
            requestId:
              result.requestId ||
              result.taskId,
            operationId:
              reservation.operationId,
            pointsCost:
              settlement.pointsCost,
            pointsRefunded:
              settlement.refunded
          }
        );

        return response.json({
          success: true,
          result,
          credits: settlement.balance,
          pointsCost:
            settlement.pointsCost,
          refundAmount:
            settlement.refundAmount
        });
      }
      catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "生成失败";

        let balance = user.credits;
        let refunded = false;

        if (reservation) {
          try {
            const refund =
              await authService.refundGenerationCredits(
                user.id,
                reservation.operationId,
                errorMessage
              );

            balance = refund.balance;
            refunded = refund.refunded;
          }
          catch (refundError) {
            console.error(
              "生图积分退款失败",
              refundError
            );
          }
        }

        await safeRecordUsage(
          authService,
          {
            ...usageInput,
            status: "failed",
            operationId:
              reservation?.operationId,
            pointsCost:
              reservation?.pointsCost,
            pointsRefunded: refunded,
            error: errorMessage
          }
        );

        if (error instanceof AuthError) {
          return response
            .status(error.status)
            .json({
              error: {
                code: error.code,
                message: error.message
              },
              credits: balance
            });
        }

        if (error instanceof ZodError) {
          return response
            .status(400)
            .json({
              error: {
                code: "INVALID_REQUEST",
                message:
                  error.issues[0]?.message ||
                  "请求参数不正确",
                issues: error.issues
              },
              credits: balance
            });
        }

        if (error instanceof ProviderHttpError) {
          console.error(
            "模型服务商接口错误",
            error.details
          );

          return response
            .status(
              error.status >= 400 &&
              error.status < 600
                ? error.status
                : 502
            )
            .json({
              error: {
                code: "PROVIDER_ERROR",
                message: error.message
              },
              credits: balance,
              refunded
            });
        }

        console.error("生图失败", error);

        return response
          .status(500)
          .json({
            error: {
              code: "INTERNAL_ERROR",
              message:
                errorMessage ||
                "生成失败，请稍后重试"
            },
            credits: balance,
            refunded
          });
      }
      finally {
        releaseGeneration?.();
      }
    }
  );

  router.get(
    "/api/images/tasks/:provider/:taskId",
    requireAuth,
    async (request, response) => {
      const user =
        getAuthenticatedUser(request);

      try {
        const provider =
          readRouteParam(
            request.params.provider
          );

        const taskId =
          readRouteParam(
            request.params.taskId
          );

        const validProviders =
          new Set<ProviderId>(["lingke"]);

        if (
          !provider ||
          !validProviders.has(
            provider as ProviderId
          )
        ) {
          return response.status(400).json({
            error: {
              code: "INVALID_PROVIDER",
              message:
                "该厂商不支持异步任务查询"
            }
          });
        }

        if (!taskId) {
          return response.status(400).json({
            error: {
              code: "INVALID_TASK_ID",
              message: "缺少 task_id"
            }
          });
        }

        const usage =
          await authService
            .getUsageRecordByRequestId(
              user.id,
              taskId
            );

        if (
          !usage ||
          usage.provider !== provider
        ) {
          return response.status(404).json({
            error: {
              code: "TASK_NOT_FOUND",
              message: "生成任务不存在"
            }
          });
        }

        const result =
          await getImageTask(
            provider as ProviderId,
            taskId,
            usage.model
          );

        let credits = user.credits;
        let pointsCost =
          usage.pointsCost || 0;
        let refundAmount = 0;

        if (
          result.status === "completed" ||
          result.status === "failed"
        ) {
          const successful =
            result.status === "completed" &&
            result.images.length > 0;

          const unitPoints =
            usage.imageCount > 0
              ? (usage.pointsCost || 0) /
                usage.imageCount
              : (
                  modelSettingsService.get(
                    provider,
                    usage.model
                  )?.points || 0
                );

          const finalized =
            await authService.finalizeAsyncUsage(
              user.id,
              taskId,
              {
                status:
                  successful
                    ? "success"
                    : "failed",
                imageCount:
                  result.images.length,
                actualPointsCost:
                  successful
                    ? calculateGenerationCreditCost(
                        unitPoints,
                        result.images.length
                      )
                    : 0,
                durationMs:
                  result.durationMs,
                cost: result.cost,
                error:
                  successful
                    ? undefined
                    : result.error ||
                      "异步任务未返回图片"
              }
            );

          credits = finalized.balance;
          pointsCost =
            finalized.pointsCost;
          refundAmount =
            finalized.refundAmount;
        }

        return response.json({
          success: true,
          result,
          credits,
          pointsCost,
          refundAmount
        });
      }
      catch (error) {
        if (
          error instanceof
          ProviderHttpError
        ) {
          console.error(
            "异步任务接口错误",
            error.details
          );

          return response
            .status(
              error.status >= 400 &&
              error.status < 600
                ? error.status
                : 502
            )
            .json({
              error: {
                code: "PROVIDER_ERROR",
                message: error.message
              }
            });
        }

        if (error instanceof AuthError) {
          return sendAuthError(
            response,
            error,
            "任务查询失败"
          );
        }

        console.error(
          "任务查询失败",
          error
        );

        return response.status(500).json({
          error: {
            code: "TASK_QUERY_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "任务查询失败"
          }
        });
      }
    }
  );

  return router;
}

function buildUsageInputFromRawRequest(
  value: unknown,
  userId: string
): Omit<UsageRecordInput, "status"> {
  const body =
    value &&
    typeof value === "object"
      ? value as Record<string, unknown>
      : {};

  const images =
    Array.isArray(body.images)
      ? body.images
      : [];

  return {
    userId,
    provider:
      typeof body.provider === "string"
        ? body.provider
        : "unknown",
    model:
      typeof body.model === "string"
        ? body.model
        : "unknown",
    operation:
      images.length > 0
        ? "image-edit"
        : "text-to-image",
    size:
      typeof body.size === "string"
        ? body.size
        : "auto",
    prompt:
      typeof body.prompt === "string"
        ? body.prompt
        : undefined,
    imageCount:
      typeof body.count === "number"
        ? body.count
        : 0
  };
}

async function safeRecordUsage(
  authService: AuthService,
  input: UsageRecordInput
): Promise<void> {
  try {
    await authService.recordUsage(input);
  }
  catch (error) {
    console.error(
      "保存使用记录失败",
      error
    );
  }
}

async function rejectGeneration(
  authService: AuthService,
  response: Response,
  usageInput:
    Omit<UsageRecordInput, "status">,
  code: string,
  message: string
): Promise<Response> {
  await safeRecordUsage(
    authService,
    {
      ...usageInput,
      status: "failed",
      error: message
    }
  );

  return response.status(400).json({
    error: {
      code,
      message
    }
  });
}

function readPositiveEnv(
  name: string,
  fallback: number
): number {
  const value =
    Number(process.env[name]);

  return (
    Number.isFinite(value) &&
    value > 0
  )
    ? Math.trunc(value)
    : fallback;
}
'@

    # ============================================================
    # server/src/services/health.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\services\health.ts") `
@'
import {
  readdir,
  stat,
  statfs
} from "node:fs/promises";
import path from "node:path";
import type {
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";

export type HealthLevel =
  "ok" |
  "warning" |
  "critical";

export interface HealthServiceOptions {
  database: AppDatabase;
  generatedDir: string;
  secureCookie: boolean;
}

export function createHealthService(
  options: HealthServiceOptions
) {
  async function check() {
    const checkedAt =
      new Date().toISOString();

    const mysqlStart =
      Date.now();

    let mysqlOk = true;
    let mysqlError:
      string | undefined;

    let users = 0;
    let activeSessions = 0;
    let pendingTasks = 0;

    try {
      await options.database.pool.query(
        "SELECT 1"
      );

      const [
        [userRows],
        [sessionRows],
        [taskRows]
      ] = await Promise.all([
        options.database.pool
          .query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM app_users`
          ),
        options.database.pool
          .query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM app_sessions
             WHERE expires_at >
             UTC_TIMESTAMP()`
          ),
        options.database.pool
          .query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM app_usage_records
             WHERE status = 'submitted'`
          )
      ]);

      users =
        Number(userRows[0]?.total || 0);

      activeSessions =
        Number(sessionRows[0]?.total || 0);

      pendingTasks =
        Number(taskRows[0]?.total || 0);
    }
    catch (error) {
      mysqlOk = false;

      mysqlError =
        error instanceof Error
          ? error.message
          : "未知 MySQL 错误";
    }

    const storage =
      await readStorage(
        options.generatedDir
      );

    const warningPercent =
      readThreshold(
        process.env
          .HEALTH_DISK_WARNING_PERCENT,
        85
      );

    const criticalPercent =
      readThreshold(
        process.env
          .HEALTH_DISK_CRITICAL_PERCENT,
        95
      );

    const diskLevel: HealthLevel =
      storage.usedPercent >=
      criticalPercent
        ? "critical"
        : storage.usedPercent >=
          warningPercent
          ? "warning"
          : "ok";

    const status: HealthLevel =
      !mysqlOk ||
      diskLevel === "critical"
        ? "critical"
        : diskLevel === "warning"
          ? "warning"
          : "ok";

    const memory =
      process.memoryUsage();

    return {
      ok: status !== "critical",
      status,
      service:
        "ecom-ai-studio-api",
      checkedAt,
      uptimeSeconds:
        Math.round(process.uptime()),
      nodeVersion:
        process.version,
      environment:
        process.env.NODE_ENV ||
        "development",
      security: {
        secureCookie:
          options.secureCookie
      },
      process: {
        pid: process.pid,
        rssBytes: memory.rss,
        heapUsedBytes:
          memory.heapUsed,
        heapTotalBytes:
          memory.heapTotal
      },
      mysql: {
        ok: mysqlOk,
        latencyMs:
          Date.now() - mysqlStart,
        users,
        activeSessions,
        pendingTasks,
        error: mysqlError
      },
      storage: {
        generatedDir:
          options.generatedDir,
        fileCount:
          storage.fileCount,
        generatedBytes:
          storage.generatedBytes,
        diskTotalBytes:
          storage.diskTotalBytes,
        diskFreeBytes:
          storage.diskFreeBytes,
        usedPercent:
          storage.usedPercent,
        level: diskLevel
      }
    };
  }

  return {
    check
  };
}

async function readStorage(
  generatedDir: string
) {
  let fileCount = 0;
  let generatedBytes = 0;

  try {
    const entries =
      await readdir(
        generatedDir,
        {
          withFileTypes: true
        }
      );

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const information =
        await stat(
          path.join(
            generatedDir,
            entry.name
          )
        );

      fileCount += 1;
      generatedBytes +=
        information.size;
    }
  }
  catch {
    fileCount = 0;
    generatedBytes = 0;
  }

  try {
    const fileSystem =
      await statfs(generatedDir);

    const blockSize =
      Number(fileSystem.bsize);

    const total =
      Number(fileSystem.blocks) *
      blockSize;

    const free =
      Number(fileSystem.bavail) *
      blockSize;

    const usedPercent =
      total > 0
        ? Number(
            (
              (
                (total - free) /
                total
              ) * 100
            ).toFixed(2)
          )
        : 0;

    return {
      fileCount,
      generatedBytes,
      diskTotalBytes: total,
      diskFreeBytes: free,
      usedPercent
    };
  }
  catch {
    return {
      fileCount,
      generatedBytes,
      diskTotalBytes: 0,
      diskFreeBytes: 0,
      usedPercent: 0
    };
  }
}

function readThreshold(
  value: string | undefined,
  fallback: number
): number {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? Math.min(
        100,
        Math.max(1, numeric)
      )
    : fallback;
}

export type HealthService =
  ReturnType<typeof createHealthService>;
'@

    # ============================================================
    # server/src/routes/system.routes.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\routes\system.routes.ts") `
@'
import { Router } from "express";
import type {
  ModelSettingsService
} from "../services/model-settings.js";
import type {
  HealthService
} from "../services/health.js";

export function createSystemRouter(options: {
  modelSettingsService: ModelSettingsService;
  healthService: HealthService;
}): Router {
  const router = Router();

  router.get(
    "/api/health",
    async (_request, response) => {
      try {
        const report =
          await options.healthService.check();

        return response
          .status(
            report.status === "critical"
              ? 503
              : 200
          )
          .json(report);
      }
      catch (error) {
        console.error(
          "健康检查失败",
          error
        );

        return response
          .status(503)
          .json({
            ok: false,
            status: "critical",
            service:
              "ecom-ai-studio-api",
            checkedAt:
              new Date().toISOString(),
            error:
              error instanceof Error
                ? error.message
                : "健康检查失败"
          });
      }
    }
  );

  router.get(
    "/api/models",
    (_request, response) => {
      response.json({
        models:
          options.modelSettingsService
            .listPublicModels()
      });
    }
  );

  return router;
}
'@

    # ============================================================
    # server/src/server.ts
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "server\src\server.ts") `
@'
import dotenv from "dotenv";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  createApp
} from "./app/create-app.js";
import {
  createAuthService
} from "./auth.js";
import {
  createAppDatabase
} from "./db/database.js";
import {
  migrateLegacyJsonData
} from "./db/legacy-migration.js";
import {
  createHistoryService
} from "./history.js";
import {
  startAsyncReconciliation
} from "./services/async-reconciliation.js";
import {
  createModelSettingsService
} from "./services/model-settings.js";
import {
  createAuditLogService
} from "./services/audit-log.js";
import {
  createAdminQueryService
} from "./services/admin-query.js";
import {
  createHealthService
} from "./services/health.js";

export async function startServer():
  Promise<void> {
  const currentFile =
    fileURLToPath(import.meta.url);

  const currentDir =
    path.dirname(currentFile);

  const projectRoot =
    path.resolve(
      currentDir,
      "../.."
    );

  dotenv.config({
    path:
      path.resolve(
        projectRoot,
        ".env"
      )
  });

  const port =
    Number(
      process.env.PORT ||
      8787
    );

  const dataDir =
    path.resolve(
      projectRoot,
      process.env
        .IMAGE_STORAGE_DIR ||
      "data"
    );

  const webDist =
    path.resolve(
      projectRoot,
      "web/dist"
    );

  const secureAuthCookie =
    process.env
      .AUTH_COOKIE_SECURE ===
    "true";

  const database =
    await createAppDatabase();

  const migrationResult =
    await migrateLegacyJsonData(
      database,
      dataDir
    );

  console.log(
    migrationResult.message
  );

  const modelSettingsService =
    createModelSettingsService(
      database
    );

  const auditLogService =
    createAuditLogService(
      database
    );

  const adminQueryService =
    createAdminQueryService(
      database
    );

  const historyService =
    createHistoryService({
      database,
      dataDir,
      maxRecords:
        Number(
          process.env
            .IMAGE_HISTORY_LIMIT ||
          0
        ),
      maxImageBytes:
        Number(
          process.env
            .IMAGE_MAX_DOWNLOAD_BYTES ||
          41_943_040
        ),
      downloadTimeoutMs:
        Number(
          process.env
            .IMAGE_DOWNLOAD_TIMEOUT_MS ||
          120_000
        )
    });

  const healthService =
    createHealthService({
      database,
      generatedDir:
        historyService.generatedDir,
      secureCookie:
        secureAuthCookie
    });

  const authService =
    createAuthService({
      database,
      sessionTtlSeconds:
        Number(
          process.env
            .AUTH_SESSION_TTL_SECONDS ||
          2_592_000
        ),
      adminUsername:
        process.env.ADMIN_USERNAME
    });

  await Promise.all([
    historyService.initialize(),
    authService.initialize(),
    modelSettingsService.initialize()
  ]);

  const health =
    await healthService.check();

  console.log(
    `启动健康状态：${health.status}`
  );

  console.log(
    `MySQL 延迟：${health.mysql.latencyMs} 毫秒`
  );

  console.log(
    `磁盘使用率：${health.storage.usedPercent}%`
  );

  if (health.status !== "ok") {
    console.warn(
      "服务器启动时发现健康预警",
      JSON.stringify(health)
    );
  }

  const stopReconciliation =
    startAsyncReconciliation(
      authService
    );

  const app =
    createApp({
      database,
      authService,
      historyService,
      modelSettingsService,
      auditLogService,
      adminQueryService,
      healthService,
      secureAuthCookie,
      webDist
    });

  const server =
    app.listen(
      port,
      () => {
        console.log(
          `Ecom AI Studio API：http://localhost:${port}`
        );

        console.log(
          `生成图片目录：${historyService.generatedDir}`
        );

        console.log(
          `MySQL 数据库：${authService.authFile}`
        );

        if (
          !process.env
            .ADMIN_USERNAME
        ) {
          console.warn(
            "尚未配置 ADMIN_USERNAME，无法自动识别站长账号"
          );
        }
      }
    );

  let closing = false;

  async function close(
    signal: string
  ): Promise<void> {
    if (closing) return;

    closing = true;

    console.log(
      `收到 ${signal}，正在安全关闭服务器……`
    );

    stopReconciliation();

    await new Promise<void>(
      (resolve) => {
        server.close(
          () => resolve()
        );
      }
    );

    await database.close()
      .catch((error) => {
        console.error(
          "关闭 MySQL 连接失败",
          error
        );
      });
  }

  for (
    const signal of [
      "SIGINT",
      "SIGTERM"
    ] as const
  ) {
    process.once(
      signal,
      () => {
        void close(signal)
          .finally(
            () => process.exit(0)
          );
      }
    );
  }
}
'@

    # ============================================================
    # scripts/backup-mysql.ps1
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "scripts\backup-mysql.ps1") `
@'
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}

$EnvPath = Join-Path $ProjectRoot ".env"

if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw "没有找到 .env：$EnvPath"
}

function Read-DotEnv {
    param([string]$Path)

    $Values = @{}

    foreach (
        $Line in
        [System.IO.File]::ReadAllLines(
            $Path,
            [System.Text.Encoding]::UTF8
        )
    ) {
        $Text = $Line.Trim()

        if (
            -not $Text -or
            $Text.StartsWith("#") -or
            $Text -notmatch "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$"
        ) {
            continue
        }

        $Name = $Matches[1]
        $Value = $Matches[2].Trim()

        if (
            $Value.Length -ge 2 -and
            (
                (
                    $Value.StartsWith('"') -and
                    $Value.EndsWith('"')
                ) -or
                (
                    $Value.StartsWith("'") -and
                    $Value.EndsWith("'")
                )
            )
        ) {
            $Value = $Value.Substring(
                1,
                $Value.Length - 2
            )
        }

        $Values[$Name] = $Value
    }

    return $Values
}

$Settings = Read-DotEnv $EnvPath

$HostName = if ($Settings.MYSQL_HOST) {
    $Settings.MYSQL_HOST
}
else {
    "127.0.0.1"
}

$Port = if ($Settings.MYSQL_PORT) {
    $Settings.MYSQL_PORT
}
else {
    "3306"
}

$Database = if ($Settings.MYSQL_DATABASE) {
    $Settings.MYSQL_DATABASE
}
else {
    "ecom_ai_studio"
}

$User = if ($Settings.MYSQL_USER) {
    $Settings.MYSQL_USER
}
else {
    "root"
}

$Password = $Settings.MYSQL_PASSWORD

$RetentionDays = if (
    $Settings.BACKUP_RETENTION_DAYS
) {
    [Math]::Max(
        1,
        [int]$Settings.BACKUP_RETENTION_DAYS
    )
}
else {
    14
}

$Candidates = @()

$DumpCommand = Get-Command `
    "mysqldump.exe" `
    -ErrorAction SilentlyContinue

if ($DumpCommand) {
    $Candidates += $DumpCommand.Source
}

$Candidates += @(
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 9.0\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
)

$DumpPath = $Candidates |
    Where-Object {
        $_ -and
        (Test-Path -LiteralPath $_)
    } |
    Select-Object -First 1

if (-not $DumpPath) {
    throw "没有找到 mysqldump.exe，请确认 MySQL 已正确安装。"
}

$BackupDirectory = Join-Path `
    $ProjectRoot `
    "backups\mysql"

New-Item `
    -ItemType Directory `
    -Path $BackupDirectory `
    -Force |
    Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$OutputPath = Join-Path `
    $BackupDirectory `
    "${Database}_$Timestamp.sql"

$OldMysqlPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $Password

try {
    Write-Host ""
    Write-Host "正在备份 MySQL 数据库……" -ForegroundColor Cyan
    Write-Host "数据库：$Database"
    Write-Host "服务器：${HostName}:$Port"

    $Arguments = @(
        "--host=$HostName",
        "--port=$Port",
        "--user=$User",
        "--default-character-set=utf8mb4",
        "--single-transaction",
        "--quick",
        "--routines",
        "--events",
        "--triggers",
        "--set-gtid-purged=OFF",
        "--result-file=$OutputPath",
        $Database
    )

    & $DumpPath @Arguments

    if ($LASTEXITCODE -ne 0) {
        Remove-Item `
            -LiteralPath $OutputPath `
            -Force `
            -ErrorAction SilentlyContinue

        throw "MySQL 备份失败，退出代码：$LASTEXITCODE"
    }
}
finally {
    $env:MYSQL_PWD = $OldMysqlPassword
}

$Cutoff = (Get-Date).AddDays(
    -$RetentionDays
)

Get-ChildItem `
    -LiteralPath $BackupDirectory `
    -Filter "*.sql" `
    -File |
    Where-Object {
        $_.LastWriteTime -lt $Cutoff
    } |
    Remove-Item -Force

$BackupFile = Get-Item `
    -LiteralPath $OutputPath

Write-Host ""
Write-Host "MySQL 数据库备份成功。" -ForegroundColor Green
Write-Host "备份文件：$($BackupFile.FullName)"
Write-Host "文件大小：$($BackupFile.Length) 字节"
Write-Host "保留时间：$RetentionDays 天"
'@

    # ============================================================
    # scripts/health-check.ps1
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "scripts\health-check.ps1") `
@'
param(
    [string]$Url = "http://127.0.0.1:8787/api/health"
)

$ErrorActionPreference = "Stop"

function Format-Size {
    param([double]$Bytes)

    if ($Bytes -ge 1GB) {
        return "{0:N2} GB" -f ($Bytes / 1GB)
    }

    if ($Bytes -ge 1MB) {
        return "{0:N2} MB" -f ($Bytes / 1MB)
    }

    if ($Bytes -ge 1KB) {
        return "{0:N2} KB" -f ($Bytes / 1KB)
    }

    return "$([Math]::Round($Bytes)) 字节"
}

try {
    Write-Host ""
    Write-Host "正在检查 Ecom AI Studio 服务器……" -ForegroundColor Cyan

    $Report = Invoke-RestMethod `
        -Uri $Url `
        -Method Get `
        -TimeoutSec 30

    Write-Host ""
    Write-Host "检查时间：$($Report.checkedAt)"
    Write-Host "运行时间：$($Report.uptimeSeconds) 秒"
    Write-Host "Node.js：$($Report.nodeVersion)"
    Write-Host ""

    if ($Report.mysql.ok) {
        Write-Host "MySQL：正常" -ForegroundColor Green
    }
    else {
        Write-Host "MySQL：异常" -ForegroundColor Red
    }

    Write-Host "MySQL 延迟：$($Report.mysql.latencyMs) 毫秒"
    Write-Host "用户数量：$($Report.mysql.users)"
    Write-Host "有效会话：$($Report.mysql.activeSessions)"
    Write-Host "待结算任务：$($Report.mysql.pendingTasks)"
    Write-Host ""

    Write-Host "保存图片：$($Report.storage.fileCount) 张"
    Write-Host "图片占用：$(Format-Size $Report.storage.generatedBytes)"
    Write-Host "磁盘总容量：$(Format-Size $Report.storage.diskTotalBytes)"
    Write-Host "磁盘剩余：$(Format-Size $Report.storage.diskFreeBytes)"
    Write-Host "磁盘使用率：$($Report.storage.usedPercent)%"
    Write-Host ""

    if ($Report.status -eq "critical") {
        Write-Host "服务器状态：严重异常" -ForegroundColor Red
        exit 1
    }

    if ($Report.status -eq "warning") {
        Write-Host "服务器状态：存在预警" -ForegroundColor Yellow
        exit 0
    }

    Write-Host "服务器状态：正常" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "服务器健康检查失败。" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Write-Host "请先确认项目已经执行 npm run dev。"
    exit 1
}
'@

    # ============================================================
    # scripts/check-sensitive-files.ps1
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "scripts\check-sensitive-files.ps1") `
@'
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}

Push-Location $ProjectRoot

try {
    $TrackedFiles = @(git ls-files)

    if ($LASTEXITCODE -ne 0) {
        throw "无法读取 Git 文件列表。"
    }

    $Problems = @()

    foreach ($Path in $TrackedFiles) {
        $Normalized = $Path.Replace("\", "/")

        if (
            $Normalized -eq ".env" -or
            $Normalized -match "^data/" -or
            $Normalized -match "^backups/" -or
            $Normalized -match "^logs/" -or
            $Normalized -match "\.(sql|dump|pem|key|pfx|p12)$"
        ) {
            $Problems += $Normalized
        }
    }

    $GitIgnorePath = Join-Path $ProjectRoot ".gitignore"

    if (-not (Test-Path $GitIgnorePath)) {
        $Problems += "缺少 .gitignore"
    }
    else {
        $GitIgnore = [System.IO.File]::ReadAllText(
            $GitIgnorePath,
            [System.Text.Encoding]::UTF8
        )

        foreach ($RequiredRule in @(
            ".env",
            "data/",
            "backups/"
        )) {
            if (
                $GitIgnore -notmatch (
                    "(?m)^" +
                    [regex]::Escape($RequiredRule) +
                    "$"
                )
            ) {
                $Problems += ".gitignore 缺少：$RequiredRule"
            }
        }
    }

    if ($Problems.Count -gt 0) {
        Write-Host ""
        Write-Host "敏感文件检查未通过：" -ForegroundColor Red

        $Problems |
            Sort-Object -Unique |
            ForEach-Object {
                Write-Host " - $_" -ForegroundColor Red
            }

        Write-Host ""
        Write-Host "已阻止提交，请先清理上述文件。"
        exit 1
    }

    Write-Host "敏感文件检查通过。" -ForegroundColor Green
}
finally {
    Pop-Location
}
'@

    # ============================================================
    # scripts/install-git-hooks.ps1
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "scripts\install-git-hooks.ps1") `
@'
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}

$GitDirectory = Join-Path $ProjectRoot ".git"

if (-not (Test-Path -LiteralPath $GitDirectory)) {
    Write-Host "没有找到 .git，已跳过 Git 安全钩子安装。"
    exit 0
}

$HookDirectory = Join-Path $GitDirectory "hooks"
$HookPath = Join-Path $HookDirectory "pre-commit"

New-Item `
    -ItemType Directory `
    -Path $HookDirectory `
    -Force |
    Out-Null

$HookLines = @(
    "#!/bin/sh",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"./scripts/check-sensitive-files.ps1`"",
    "exit `$?"
)

$HookContent = $HookLines -join "`n"

[System.IO.File]::WriteAllText(
    $HookPath,
    $HookContent + "`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Git 提交前敏感文件检查已安装。" -ForegroundColor Green
'@

    # ============================================================
    # docs/V11-运维说明.md
    # ============================================================

    Write-Utf8File `
        (Join-Path $ProjectRoot "docs\V11-运维说明.md") `
@'
# Ecom AI Studio V11 运维说明

## V11 新增功能

1. 生图接口请求限流。
2. 每位用户的并发生图保护。
3. 全站生图并发上限。
4. MySQL 健康检查。
5. Node.js 内存和运行时间检查。
6. 图片目录容量统计。
7. 磁盘容量预警。
8. MySQL 一键备份。
9. 自动清理过期备份。
10. Git 敏感文件提交防护。

## 启动项目

```powershell
npm run dev