# Ecom AI Studio V10

面向电商商品图的 AI 生图工作台，支持多服务商、账号审核、按张积分计费、卡密充值、MySQL 历史归档和独立站长后台。

## 核心功能

- Vue 3 + TypeScript + Vite 前端
- Node.js + Express 服务端
- MySQL 8.4 或兼容版本
- 百嘉瑞AI、GPT（GRSAI）与 Nano Banana
- 文生图、参考图生成、多参考图上传
- 按实际成功图片数量结算积分，失败或少出图片自动退款
- 异步任务由服务器补查并自动结算
- 用户审核、封禁、恢复、强制退出
- 用户积分、卡密、使用记录和跨设备生成历史
- 生成原图按用户权限隔离

## V10 独立站长后台

站长登录后从前台点击“站长后台”，进入：

```text
/admin
```

后台包含：

- 数据总览：用户、今日任务、图片、积分、历史和 7 天趋势
- 用户管理：搜索、状态筛选、分页、审核、积分、登录和使用记录
- 卡密管理：批量生成、状态筛选、分页、复制、导出和删除未使用卡密
- 模型与价格：模型启停、单张积分价格和 API 配置状态
- 操作审计：记录用户修改、积分调整、卡密操作和模型设置

## MySQL 配置

根目录 `.env`：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=ecom_ai_studio
MYSQL_USER=root
MYSQL_PASSWORD=你的MySQL密码
MYSQL_CONNECTION_LIMIT=10
MYSQL_AUTO_CREATE_DATABASE=true
MYSQL_MIGRATE_JSON=true
MYSQL_SSL=false
```

## 安装与运行

```powershell
npm install
npm run db:setup -w server
npm run dev
```

前端：`http://localhost:5173`  
独立站长后台：`http://localhost:5173/admin`  
API 健康检查：`http://localhost:8787/api/health`

## 构建

```powershell
npm run build
npm start
```

## MySQL 数据表

```text
app_users                 用户和积分余额
app_sessions              登录会话
app_login_records         登录记录
app_usage_records         AI 使用与异步任务
app_credit_transactions   积分流水
app_recharge_cards        充值卡密
app_history_records       生成历史
app_history_images        历史图片及文件归属
app_model_settings        模型启停与单张积分价格
app_admin_audit_logs      站长操作审计
app_schema_migrations     数据迁移状态
```

V10 启动时会为现有模型自动补齐设置记录，不覆盖站长后来修改的启停状态和价格。

## 关键目录

```text
web/src/AdminApp.vue                    独立站长后台
web/src/admin-page.css                  后台响应式样式
web/src/App.vue                         创作工作台组合层
web/src/components/                     前台组件
web/src/api/client.ts                   统一 HTTP 客户端
server/src/routes/admin.routes.ts       站长后台 API
server/src/services/admin-query.ts      看板、分页和筛选查询
server/src/services/model-settings.ts   模型启停与动态价格
server/src/services/audit-log.ts        操作审计
server/src/db/schema.ts                 MySQL 表结构
server/src/server.ts                    服务初始化与优雅关闭
```

不要把 `.env`、`data/auth.json`、`data/history.json` 和 `data/generated` 提交到 GitHub。
