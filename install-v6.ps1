param(
    [string]$ProjectRoot = "E:\Code\Ecom-AI-Studio"
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $ProjectRoot ".v6-backup-$timestamp"

$targets = @(
    "server\src\auth.ts",
    "server\src\index.ts",
    "web\src\App.vue",
    "web\src\AdminPanel.vue",
    "web\src\style.css"
)

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText(
        $Path,
        [System.Text.Encoding]::UTF8
    ).Replace("`r`n", "`n")
}

function Write-Utf8([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText(
        $Path,
        $Content.Replace("`r`n", "`n"),
        $utf8NoBom
    )
}

function Replace-Once(
    [string]$Text,
    [string]$Old,
    [string]$New,
    [string]$Label
) {
    # 统一换行符，避免 Windows CRLF 与项目 LF 不一致而定位失败
    $Text = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
    $Old = $Old.Replace("`r`n", "`n").Replace("`r", "`n")
    $New = $New.Replace("`r`n", "`n").Replace("`r", "`n")

    $first = $Text.IndexOf(
        $Old,
        [System.StringComparison]::Ordinal
    )

    if ($first -lt 0) {
        throw "补丁定位失败：$Label。请确认项目代码与补丁目标一致。"
    }

    $last = $Text.LastIndexOf(
        $Old,
        [System.StringComparison]::Ordinal
    )

    if ($first -ne $last) {
        throw "补丁定位不唯一：$Label。"
    }

    return $Text.Substring(0, $first) +
        $New +
        $Text.Substring($first + $Old.Length)
}

function Backup-Files {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    foreach ($relative in $targets) {
        $source = Join-Path $ProjectRoot $relative

        if (-not (Test-Path $source)) {
            throw "缺少文件：$source"
        }

        $destination = Join-Path $backupRoot $relative

        New-Item `
            -ItemType Directory `
            -Path (Split-Path $destination -Parent) `
            -Force | Out-Null

        Copy-Item $source $destination -Force
    }
}

function Restore-Files {
    foreach ($relative in $targets) {
        $source = Join-Path $backupRoot $relative
        $destination = Join-Path $ProjectRoot $relative

        if (Test-Path $source) {
            Copy-Item $source $destination -Force
        }
    }
}

try {
    if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
        throw "项目目录不正确：$ProjectRoot"
    }

    Backup-Files

    # ==========================================
    # 1. auth.ts：增加删除未使用卡密的方法
    # ==========================================

    $authPath = Join-Path $ProjectRoot "server\src\auth.ts"
    $auth = Read-Utf8 $authPath

    $authOld = @'
  async function listRechargeCards(limit = 200): Promise<RechargeCardSummary[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    return data.rechargeCards.slice(0, clampLimit(limit)).map(toRechargeCardSummary);
  }

  async function redeemRechargeCard(userId: string, codeInput: unknown): Promise<{ user: PublicUser; transaction: CreditTransaction }> {
'@

    $authNew = @'
  async function listRechargeCards(limit = 200): Promise<RechargeCardSummary[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    return data.rechargeCards.slice(0, clampLimit(limit)).map(toRechargeCardSummary);
  }

  async function deleteUnusedRechargeCard(
    cardId: string,
    actorUserId: string
  ): Promise<void> {
    if (!cardId) {
      throw new AuthError(400, "INVALID_CARD_ID", "缺少卡密 ID");
    }

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      ensureAdmin(data, actorUserId);

      const cardIndex = data.rechargeCards.findIndex(
        (item) => item.id === cardId
      );

      if (cardIndex < 0) {
        throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在");
      }

      const card = data.rechargeCards[cardIndex];

      if (!card) {
        throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在");
      }

      if (card.redeemedAt) {
        throw new AuthError(
          409,
          "CARD_ALREADY_REDEEMED",
          "已使用的卡密不能删除"
        );
      }

      data.rechargeCards.splice(cardIndex, 1);
      await atomicWriteJson(authFile, data);
    });
  }

  async function redeemRechargeCard(userId: string, codeInput: unknown): Promise<{ user: PublicUser; transaction: CreditTransaction }> {
'@

    $auth = Replace-Once `
        $auth `
        $authOld `
        $authNew `
        "auth.ts 增加删除卡密方法"

    $auth = Replace-Once `
        $auth `
        "    listRechargeCards,`n    redeemRechargeCard," `
        "    listRechargeCards,`n    deleteUnusedRechargeCard,`n    redeemRechargeCard," `
        "auth.ts 导出删除卡密方法"

    Write-Utf8 $authPath $auth

    # ==========================================
    # 2. index.ts：删除卡密接口、多图计费
    # ==========================================

    $indexPath = Join-Path $ProjectRoot "server\src\index.ts"
    $index = Read-Utf8 $indexPath

    $routeOld = @'
app.post("/api/admin/cards", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const body = request.body as { points?: unknown; quantity?: unknown };
    const cards = await authService.generateRechargeCards(body?.points, body?.quantity, actor.id);
    return response.status(201).json({ success: true, cards });
  } catch (error) {
    return sendAuthError(response, error, "生成卡密失败");
  }
});

app.use("/generated", requireAuth, express.static(historyService.generatedDir, {
'@

    $routeNew = @'
app.post("/api/admin/cards", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const body = request.body as { points?: unknown; quantity?: unknown };
    const cards = await authService.generateRechargeCards(body?.points, body?.quantity, actor.id);
    return response.status(201).json({ success: true, cards });
  } catch (error) {
    return sendAuthError(response, error, "生成卡密失败");
  }
});

app.delete("/api/admin/cards/:id", requireAuth, requireAdmin, async (request, response) => {
  try {
    const actor = getAuthenticatedUser(request);
    const cardId = readRouteParam(request.params.id);

    if (!cardId) {
      return response.status(400).json({
        error: {
          code: "INVALID_CARD_ID",
          message: "缺少卡密 ID"
        }
      });
    }

    await authService.deleteUnusedRechargeCard(cardId, actor.id);
    return response.json({ success: true });
  } catch (error) {
    return sendAuthError(response, error, "删除卡密失败");
  }
});

app.use("/generated", requireAuth, express.static(historyService.generatedDir, {
'@

    $index = Replace-Once `
        $index `
        $routeOld `
        $routeNew `
        "index.ts 增加卡密删除接口"

    $index = Replace-Once `
        $index `
        '    const pointsCost = getModelCreditCost(model.provider, model.id);' `
        '    const pointsCost = Number((getModelCreditCost(model.provider, model.id) * input.count).toFixed(2));' `
        "index.ts 按图片数量计费"

    Write-Utf8 $indexPath $index

    # ==========================================
    # 3. App.vue：按张计算积分并移动积分区域
    # ==========================================

    $appPath = Join-Path $ProjectRoot "web\src\App.vue"
    $app = Read-Utf8 $appPath

    $app = Replace-Once `
        $app `
        'const selectedCreditCost = computed(() => selectedModel.value?.creditCost || 0);' `
        @'
const selectedUnitCreditCost = computed(
  () => selectedModel.value?.creditCost || 0
);

const selectedCreditCost = computed(() =>
  Number(
    (
      selectedUnitCreditCost.value *
      Math.max(1, count.value)
    ).toFixed(2)
  )
);
'@ `
        "App.vue 计算多图积分"

    $modelAnchorOld = @'
          </div>

          <div class="field-block">
            <label>生成方式</label>
'@

    $modelAnchorNew = @'
          </div>

          <div
            v-if="authUser"
            class="generation-credit-bar"
            :class="{ insufficient: !hasEnoughCredits }"
          >
            <span>
              单张
              <strong>
                {{
                  authUser.role === 'admin'
                    ? '0'
                    : formatPoints(selectedUnitCreditCost)
                }}
              </strong>
              积分 × {{ count }} 张
            </span>

            <span>
              {{
                authUser.role === 'admin'
                  ? '站长账号不限积分'
                  : `预计消耗 ${formatPoints(selectedCreditCost)}，剩余 ${formatPoints(authUser.credits)} 积分`
              }}
            </span>

            <button
              v-if="authUser.role !== 'admin'"
              type="button"
              @click="userPanelOpen = true"
            >
              充值与明细
            </button>
          </div>

          <div class="field-block">
            <label>生成方式</label>
'@

    $app = Replace-Once `
        $app `
        $modelAnchorOld `
        $modelAnchorNew `
        "App.vue 将积分区域移动到模型选择处"

    $oldCreditBar = @'
          <div v-if="authUser" class="generation-credit-bar" :class="{ insufficient: !hasEnoughCredits }">
            <span>本次消耗 <strong>{{ authUser.role === 'admin' ? '0' : formatPoints(selectedCreditCost) }}</strong> 积分</span>
            <span>{{ authUser.role === 'admin' ? '站长账号不限积分' : `剩余 ${formatPoints(authUser.credits)} 积分` }}</span>
            <button v-if="authUser.role !== 'admin'" type="button" @click="userPanelOpen = true">充值与明细</button>
          </div>
'@

    $app = Replace-Once `
        $app `
        $oldCreditBar `
        "" `
        "App.vue 删除原积分区域"

    Write-Utf8 $appPath $app

    # ==========================================
    # 4. AdminPanel.vue：删除未使用卡密
    # ==========================================

    $adminPath = Join-Path $ProjectRoot "web\src\AdminPanel.vue"
    $admin = Read-Utf8 $adminPath

    $admin = Replace-Once `
        $admin `
        'const generatedCards = ref<RechargeCard[]>([]);' `
        "const generatedCards = ref<RechargeCard[]>([]);`nconst deletingCardId = ref<string | null>(null);" `
        "AdminPanel.vue 增加删除状态"

    $deleteFunction = @'
async function deleteCard(card: RechargeCard) {
  if (card.status !== "unused") return;

  const confirmed = window.confirm(
    `确定删除未使用卡密 ${card.codePreview} 吗？删除后不可恢复。`
  );

  if (!confirmed) return;

  deletingCardId.value = card.id;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await api(
      `/api/admin/cards/${encodeURIComponent(card.id)}`,
      { method: "DELETE" }
    );

    cards.value = cards.value.filter(
      (item) => item.id !== card.id
    );

    generatedCards.value = generatedCards.value.filter(
      (item) => item.id !== card.id
    );

    successMessage.value = "未使用卡密已删除";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "删除卡密失败";
  } finally {
    deletingCardId.value = null;
  }
}

async function copyGeneratedCards() {
'@

    $admin = Replace-Once `
        $admin `
        "async function copyGeneratedCards() {`n" `
        $deleteFunction `
        "AdminPanel.vue 增加删除卡密操作"

    $cardTableOld = @'
          <div v-else class="admin-card-table"><article v-for="card in cards" :key="card.id"><div><code>{{ card.codePreview }}</code><span :class="card.status">{{ card.status === 'unused' ? '未使用' : '已充值' }}</span></div><strong>{{ formatPoints(card.points) }} 积分</strong><p>生成：{{ formatDate(card.createdAt) }} · {{ card.createdBy }}</p><small v-if="card.redeemedAt">充值：{{ formatDate(card.redeemedAt) }} · {{ card.redeemedByUsername }}</small></article><div v-if="!cards.length" class="admin-empty large">暂无卡密记录</div></div>
'@

    $cardTableNew = @'
          <div v-else class="admin-card-table">
            <article
              v-for="card in cards"
              :key="card.id"
            >
              <div>
                <code>{{ card.codePreview }}</code>
                <span :class="card.status">
                  {{
                    card.status === 'unused'
                      ? '未使用'
                      : '已充值'
                  }}
                </span>
              </div>

              <strong>
                {{ formatPoints(card.points) }} 积分
              </strong>

              <p>
                生成：{{ formatDate(card.createdAt) }}
                · {{ card.createdBy }}
              </p>

              <small v-if="card.redeemedAt">
                充值：{{ formatDate(card.redeemedAt) }}
                · {{ card.redeemedByUsername }}
              </small>

              <button
                v-if="card.status === 'unused'"
                type="button"
                class="admin-card-delete"
                :disabled="deletingCardId === card.id"
                @click="deleteCard(card)"
              >
                {{
                  deletingCardId === card.id
                    ? '删除中…'
                    : '删除未使用卡密'
                }}
              </button>
            </article>

            <div
              v-if="!cards.length"
              class="admin-empty large"
            >
              暂无卡密记录
            </div>
          </div>
'@

    $admin = Replace-Once `
        $admin `
        $cardTableOld `
        $cardTableNew `
        "AdminPanel.vue 增加卡密删除按钮"

    $adminStyleOld = '<style src="./admin.css"></style>'

    $adminStyleNew = @'
<style src="./admin.css"></style>

<style scoped>
.admin-card-delete {
  margin-top: 10px;
  width: 100%;
  border: 1px solid #f0b6b6;
  background: #fff5f5;
  color: #b23b3b;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 750;
}

.admin-card-delete:hover {
  border-color: #df7777;
  background: #fff0f0;
}

.admin-card-delete:disabled {
  opacity: 0.55;
}
</style>
'@

    $admin = Replace-Once `
        $admin `
        $adminStyleOld `
        $adminStyleNew `
        "AdminPanel.vue 卡密删除按钮样式"

    Write-Utf8 $adminPath $admin

    # ==========================================
    # 5. style.css：生成结果悬浮
    # ==========================================

    $stylePath = Join-Path $ProjectRoot "web\src\style.css"
    $style = Read-Utf8 $stylePath

    $style = Replace-Once `
        $style `
        '..result-column {' `
        '.result-column {' `
        "style.css 修复 result-column 选择器"

    $previewOld = @'
.preview-panel {
  position: static;
  padding: 25px;
  min-height: 740px;
  display: flex;
  flex-direction: column;
}
'@

    $previewNew = @'
.preview-panel {
  position: sticky;
  top: 94px;
  max-height: calc(100vh - 116px);
  overflow-y: auto;
  padding: 25px;
  min-height: 740px;
  display: flex;
  flex-direction: column;
}
'@

    $style = Replace-Once `
        $style `
        $previewOld `
        $previewNew `
        "style.css 设置结果悬浮"

    $style = Replace-Once `
        $style `
        '  .preview-panel { position: static; min-height: 680px; }' `
        '  .preview-panel { position: static; top: auto; max-height: none; overflow: visible; min-height: 680px; }' `
        "style.css 小屏幕取消悬浮"

    Write-Utf8 $stylePath $style

    # ==========================================
    # 6. 执行完整构建
    # ==========================================

    Push-Location $ProjectRoot

    try {
        npm run build

        if ($LASTEXITCODE -ne 0) {
            throw "项目构建失败，退出代码：$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "v6 补丁安装成功。" -ForegroundColor Green
    Write-Host "备份目录：$backupRoot"
    Write-Host "重新运行 npm run dev 后即可使用。"
}
catch {
    Write-Host "安装失败，正在还原原文件……" `
        -ForegroundColor Yellow

    if (Test-Path $backupRoot) {
        Restore-Files
    }

    Write-Host "原文件已还原。备份目录：$backupRoot" `
        -ForegroundColor Yellow

    throw
}