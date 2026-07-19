# Ecom AI Studio（百嘉瑞AI 比例修复版） · 百嘉瑞AI 专用版

面向电商商品图的 AI 生图工作台。本版本仅接入 **百嘉瑞AI / GPT Image 2**，已移除 Mock、OpenAI、阿里云百炼和火山方舟等其他模型。

## 已实现功能

- Vue 3 + TypeScript + Vite 前端
- Node.js + Express 服务端
- 百嘉瑞AI `gpt-image-2`
- 文生图和商品参考图生成
- 多参考图上传
- 画面比例、生成数量和提示词模板
- 异步任务自动轮询
- 进度、费用、错误信息展示
- 生成结果预览和下载
- API Key 仅保存在服务端

## 1. 环境要求

- Node.js 20.19 或更高版本
- npm 10 或更高版本

```bash
node -v
npm -v
```

## 2. 安装依赖

在项目根目录执行：

```bash
npm install
```

## 3. 配置百嘉瑞AI

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

编辑根目录 `.env`：

```env
LINGKE_API_KEY=sk-xxxxxxxx
LINGKE_BASE_URL=https://api.lk888.ai
LINGKE_IMAGE_ENDPOINT=/v1/media/generate
LINGKE_STATUS_ENDPOINT=/v1/media/status
LINGKE_IMAGE_MODEL=gpt-image-2
```

不要把 `.env` 提交到 GitHub。

## 4. 本地运行

```bash
npm run dev
```

打开：

- 前端：http://localhost:5173
- API 健康检查：http://localhost:8787/api/health

## 5. 构建与生产运行

```bash
npm run build
npm start
```

生产模式下，Express 服务端会托管 `web/dist`。

## 接口流程

1. 服务端调用 `POST /v1/media/generate` 创建任务。
2. 接口返回 `task_id`。
3. 前端每 2 秒查询本站任务接口。
4. 本站服务端调用 `GET /v1/media/status?task_id=...`。
5. 当 `is_final=true` 且 `state=success` 时，读取 `result_url` 并展示图片。

## 项目结构

```text
Ecom-AI-Studio-Lingke-Only/
├── web/
├── server/
│   └── src/
│       ├── providers/lingke.ts
│       ├── models.ts
│       ├── router.ts
│       └── index.ts
├── .env.example
├── package.json
└── README.md
```


## 生成质量

页面支持 `auto`（自动，推荐）、`high`（高）、`medium`（中）和 `low`（低），并原样传递给百嘉瑞AI 的 `params.quality`。


## 画面比例修复

本版本不再同时发送 `aspect_ratio` 与 `size: auto`。服务端仅发送用户选择的 `aspect_ratio`，避免 `size` 参数覆盖画面比例。结果卡片会显示服务商实际返回图片的像素尺寸与真实宽高比，便于核验。


## 本次更新

- 将“画面比例”改为“输出尺寸”
- 前端直接选择并提交百嘉瑞AI 支持的 `size` 枚举值
- 后端不再提交 `aspect_ratio`，避免与实际出图比例不一致
- 支持文生图与参考图生图


## 界面增强

- 新增“文生图 / 参考图生成”显式模式切换
- 参考图模式会强制校验至少上传一张图片
- 文生图模式默认使用 1024×1024，避免无参考图时使用 auto
- 输出尺寸改为带比例预览的精致卡片选择器
- 结果摘要显示当前生成方式和输出规格


## 生成方式按钮优化

- “文生图”和“参考图生成”改为并列卡片按钮
- 增加选中态、悬停态、图标和勾选状态
- 保持移动端单列展示


## 尺寸卡片精简

- 删除输出尺寸卡片中的灰色用途说明
- 仅保留尺寸名称、接口像素值、比例图标和选中状态
- 缩小卡片高度，使界面更紧凑


## 界面调整

- 删除“开始生成”按钮下方的 API Key 提示文字。


## 预设按钮优化

- 放大“高级棚拍、科技首屏、日式场景、白底精修”四个画面描述预设按钮
- 增加按钮内边距、字号、圆角与悬停反馈


## 顶栏标识更新

- 版本标识：`BJR 0.1`
- 外部链接：`517ZHE`，指向 `https://517zhe.com/`


## 品牌更新

左上角品牌文字已由 `Ecom AI / STUDIO` 更新为 `BJR AI / STUDIO`，原样式保持不变。


## 本次界面调整

- 放大结果区底部摘要栏标题和内容字号
- 增加摘要栏高度与内边距，提高可读性


## 自定义画面描述预设

- 在预设按钮第一位新增“自定义”
- 点击后自动清空画面描述并聚焦输入框


## 本次界面调整

- “参考图生成”调整到生成方式第一位
- “文生图”调整到第二位
- 生成逻辑与默认模式保持不变


## 本次界面调整

- 放大生成结果空状态标题与说明文字
- 放大“主体保持 / 智能布光”浮动标签
- 放大底部功能标签并增加留白
- 保持原有布局、颜色和视觉结构不变


## 顶部工作台标题放大

- “百嘉瑞AI 电商视觉工作台”字号由 13px 调整为 18px
- 同步提高字重并优化文字颜色，顶栏其他布局保持不变
