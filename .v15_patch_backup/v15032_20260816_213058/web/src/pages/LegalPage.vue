<script setup lang="ts">
import {
  onMounted,
  ref
} from "vue";
import {
  FileText,
  Layers3,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Wrench
} from "@lucide/vue";
import PlatformAccountMenu from "../components/PlatformAccountMenu.vue";
import {
  ApiError,
  apiRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";

interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface LegalDocument {
  eyebrow: string;
  title: string;
  summary: string;
  sections: LegalSection[];
}

const user = ref<AuthUser | null>(null);
const ready = ref(false);

const documents: Record<string, LegalDocument> = {
  "/terms": {
    eyebrow: "TERMS OF SERVICE",
    title: "用户协议",
    summary: "本协议用于说明用户使用 ZHE AI 账号、AI 创作、批量生产、作品管理及相关工具时的基本规则。",
    sections: [
      {
        title: "1. 服务范围",
        paragraphs: [
          "ZHE AI 提供 AI 图像生成、参考图再创作、批量任务、作品管理、电商工具及后续上线的相关功能。具体可用功能、模型、积分规则与服务方式，以平台实际页面展示为准。"
        ]
      },
      {
        title: "2. 账号与使用责任",
        bullets: [
          "用户应提供真实、有效且可正常使用的账号信息，并妥善保管登录凭证。",
          "因用户主动泄露账号、共享密码或未妥善保管设备造成的风险，由用户自行承担。",
          "用户不得利用平台从事违法、侵权、欺诈、恶意攻击、批量滥用或其他影响平台正常运行的行为。"
        ]
      },
      {
        title: "3. 上传素材与知识产权",
        bullets: [
          "用户应确保对上传的商品图、人物图、Logo、包装、文字、商标及其他素材拥有合法使用权或已取得必要授权。",
          "用户上传素材的权利归属不会因使用平台而自动转移给 ZHE AI。",
          "如第三方就用户上传内容提出权利主张，平台可视情况暂停相关内容或账号，并要求用户提供必要的权利证明。"
        ]
      },
      {
        title: "4. AI 生成结果",
        paragraphs: [
          "AI 生成内容具有概率性和不确定性，平台不保证结果完全准确、唯一、无瑕疵或适合任何特定商业目的。用户在发布、投放、印刷、上架或商业使用前，应自行审核文字、人物、商标、包装、产品细节及其他关键内容。"
        ]
      },
      {
        title: "5. 积分、付费与退款",
        paragraphs: [
          "如平台提供积分、充值、会员或其他付费服务，具体计费、扣除、失败退款及有效期规则以购买页面、积分记录和平台当期规则为准。因模型实际成功数量不同而产生的结算，以系统记录为准。"
        ]
      },
      {
        title: "6. 服务调整与中断",
        paragraphs: [
          "平台可能因模型服务商调整、系统维护、网络故障、安全风险、政策要求或产品升级而变更、暂停或下线部分功能。平台会在合理范围内提供通知，但无法保证所有第三方服务始终可用。"
        ]
      },
      {
        title: "7. 协议更新与联系",
        paragraphs: [
          "平台可根据业务变化更新本协议。重大调整会通过公告、站内消息或页面提示进行说明。如有问题，可通过站内“意见反馈”入口联系平台。"
        ]
      }
    ]
  },
  "/privacy": {
    eyebrow: "PRIVACY POLICY",
    title: "隐私政策",
    summary: "本政策说明 ZHE AI 在提供账号、AI 生成、作品存储和平台安全服务时，可能处理的信息类型及使用方式。",
    sections: [
      {
        title: "1. 我们可能处理的信息",
        bullets: [
          "账号信息：用户名、昵称、账号状态、积分及必要的账号管理信息。",
          "创作信息：提示词、上传参考图、生成结果、生成参数、任务记录、作品文件夹与标签。",
          "设备与日志信息：访问时间、IP、浏览器或设备信息、操作日志以及用于安全审计的必要记录。",
          "服务记录：反馈、消息、积分流水及在启用充值或付费功能时产生的必要交易记录。"
        ]
      },
      {
        title: "2. 信息的使用目的",
        bullets: [
          "完成账号登录、AI 生成、任务处理、作品保存、积分结算及用户主动请求的功能。",
          "识别异常访问、滥用、攻击、账号安全风险并维护平台稳定运行。",
          "处理用户反馈、客服沟通、故障排查和产品体验优化。",
          "在法律法规或监管要求适用时，履行必要的合规义务。"
        ]
      },
      {
        title: "3. 第三方模型与服务商",
        paragraphs: [
          "为完成用户发起的 AI 任务，平台可能将完成该任务所必需的提示词、参考图片、生成参数或其他必要内容发送至已配置的第三方模型服务商。不同服务商可能适用其自身的数据处理和服务规则。平台仅应在实现用户所选功能所需的范围内调用相关服务。"
        ]
      },
      {
        title: "4. 存储、删除与保留",
        paragraphs: [
          "用户可通过作品库、历史记录或账号功能管理和删除部分内容。为保障系统安全、交易核对、故障追踪或满足必要的业务与合规要求，部分日志、备份或审计记录可能在合理期限内继续保留。"
        ]
      },
      {
        title: "5. 信息安全",
        paragraphs: [
          "平台会采取合理的访问控制、权限管理、传输与存储保护措施降低数据风险，但任何互联网服务都无法保证绝对安全。用户也应避免上传与任务无关的敏感信息，并妥善保护自己的账号。"
        ]
      },
      {
        title: "6. 用户权利与联系",
        paragraphs: [
          "用户可通过账号中心和站内功能查看、修改部分账号信息，并管理作品与历史记录。如需进一步查询、更正、删除或反馈与个人信息相关的问题，可通过站内“意见反馈”联系我们。"
        ]
      }
    ]
  },
  "/ai-content": {
    eyebrow: "AI CONTENT NOTICE",
    title: "AI 内容说明",
    summary: "AI 生成结果不是人工设计稿的等价替代，正式用于电商经营前应进行必要的人工作品审核。",
    sections: [
      {
        title: "1. 生成内容的性质",
        paragraphs: [
          "平台通过第三方或自有接入的生成式模型，根据用户提供的提示词、参考图片和参数产生内容。模型输出具有随机性，即使使用相同输入，也可能得到不同结果。"
        ]
      },
      {
        title: "2. 结果可能存在的问题",
        bullets: [
          "文字、数字、Logo、包装结构、人物肢体或商品细节可能出现错误。",
          "生成结果可能与真实商品、真实场景或用户预期存在差异。",
          "模型可能生成与已有作品、风格、人物或品牌存在相似性的内容。"
        ]
      },
      {
        title: "3. 用户审核义务",
        paragraphs: [
          "在将生成结果用于商品上架、广告投放、详情页、印刷、包装、社交媒体或其他公开商业场景前，用户应自行核对商品信息、价格、规格、功效描述、知识产权、肖像、商标及平台规则。"
        ]
      },
      {
        title: "4. 不应仅依赖 AI 的场景",
        paragraphs: [
          "涉及医疗功效、法律承诺、金融收益、安全参数、食品与健康声明、强制性标签或其他高风险信息时，不应仅依据 AI 生成结果直接发布，应由具备相应资质或专业能力的人员复核。"
        ]
      }
    ]
  },
  "/commercial-use": {
    eyebrow: "COMMERCIAL USE",
    title: "商业使用说明",
    summary: "商业使用前，应同时确认上传素材、生成模型、第三方服务条款及最终作品本身不存在影响使用的权利限制。",
    sections: [
      {
        title: "1. 商业使用的一般原则",
        paragraphs: [
          "平台不会因为用户通过 ZHE AI 生成内容而自动取得用户作品的商业权利，也不对任何生成结果作绝对的权利清洁保证。用户拟商业使用时，应结合实际使用地区、渠道、模型服务商规则和素材权属自行判断。"
        ]
      },
      {
        title: "2. 用户自有素材",
        bullets: [
          "商品照片、品牌 Logo、包装、模特照片、字体、插画、摄影作品等第三方素材，应由用户确认已取得相应商业授权。",
          "使用名人、公众人物、普通自然人肖像或明显可识别形象时，应确认具有合法使用依据。",
          "不得通过 AI 生成或修改内容来规避原素材的版权、商标、肖像或其他权利限制。"
        ]
      },
      {
        title: "3. 模型与第三方服务限制",
        paragraphs: [
          "不同模型及 API 服务商可能对商业使用、禁止内容、地域、输出内容或责任分配设置不同规则。平台接入某一模型并不代表其所有输出在所有场景下均可自由商用。"
        ]
      },
      {
        title: "4. 发布前建议",
        bullets: [
          "核对商品、包装、文字、价格、规格和宣传表述是否准确。",
          "确认图片中不存在未经授权的商标、人物、角色、艺术作品或其他受保护元素。",
          "对于重点投放、线下印刷、大规模广告或高价值商业项目，建议在发布前完成必要的人工设计审核和权利核查。"
        ]
      }
    ]
  }
};

const normalizedPath =
  window.location.pathname
    .replace(/\/+$/, "") || "/";

const current: LegalDocument =
  documents[normalizedPath] ??
  documents["/terms"]!;

onMounted(async () => {
  try {
    const result =
      await apiRequest<{
        user: AuthUser
      }>("/api/auth/me");
    user.value = result.user;
  }
  catch (error) {
    if (
      !(
        error instanceof ApiError &&
        error.status === 401
      )
    ) {
      console.error(
        "Load legal account error",
        error
      );
    }
    user.value = null;
  }
  finally {
    ready.value = true;
  }
});
</script>

<template>
  <div class="v15-legal-page v1501-home">
    <header class="v15-home-nav">
      <a class="v15-home-brand" href="/">
        <span>Z</span>
        <div>
          <strong>ZHE AI</strong>
          <small>ECOMMERCE AI STUDIO</small>
        </div>
      </a>

      <nav>
        <a href="/workspace"><Sparkles :size="16" />AI 创作</a>
        <a href="/batch"><Layers3 :size="16" />批量生产</a>
        <a href="/tools"><Wrench :size="16" />工具中心</a>
        <a href="/gallery"><Lightbulb :size="16" />灵感广场</a>
      </nav>

      <div class="v15-home-account">
        <PlatformAccountMenu
          v-if="ready && user"
          :user="user"
        />
        <a
          v-else-if="ready"
          class="primary"
          href="/workspace"
        >登录 / 注册</a>
        <span
          v-else
          class="v15-home-account-skeleton"
        ></span>
      </div>
    </header>

    <main class="v15-legal-main">
      <header class="v15-legal-hero">
        <span class="v15-legal-icon">
          <ShieldCheck :size="24" :stroke-width="1.8" />
        </span>
        <div>
          <span>{{ current.eyebrow }}</span>
          <h1>{{ current.title }}</h1>
          <p>{{ current.summary }}</p>
        </div>
      </header>

      <aside class="v15-legal-template-note">
        <FileText :size="18" :stroke-width="1.8" />
        <div>
          <strong>通用条款模板</strong>
          <p>
            当前版本用于平台页面占位和基础说明。正式商业运营前，建议结合实际运营主体、收费与退款方式、数据存储位置、第三方模型服务商条款及业务所在地要求进行专业法律审阅和完善。
          </p>
        </div>
      </aside>

      <article class="v15-legal-document">
        <section
          v-for="section in current.sections"
          :key="section.title"
        >
          <h2>{{ section.title }}</h2>
          <p
            v-for="paragraph in section.paragraphs || []"
            :key="paragraph"
          >
            {{ paragraph }}
          </p>
          <ul v-if="section.bullets?.length">
            <li
              v-for="bullet in section.bullets"
              :key="bullet"
            >
              {{ bullet }}
            </li>
          </ul>
        </section>
      </article>

      <nav class="v15-legal-links" aria-label="其他规则">
        <a href="/terms">用户协议</a>
        <a href="/privacy">隐私政策</a>
        <a href="/ai-content">AI 内容说明</a>
        <a href="/commercial-use">商业使用说明</a>
        <a href="/account?tab=feedback">意见反馈</a>
      </nav>
    </main>
  </div>
</template>
