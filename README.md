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
app_generation_tasks      实时生成任务与进度
app_usage_records         AI 使用与最终统计
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

## V12.1 服务端结果归档

- 服务端自动下载并保存模型生成图片
- 任务通过 generation_task_id 与历史作品幂等关联
- 用户关闭页面后，百嘉瑞异步任务完成仍会进入历史记录
- 浏览器不再是生成结果永久保存的唯一执行者

## V12.2 正式任务中心

- 生成任务支持服务端分页
- 支持运行状态、服务商和关键词筛选
- 显示任务汇总数据和详细信息
- 旧任务可按 history_id 精确读取结果
- 任务刷新、筛选与分页状态彼此独立

## V12.3 任务故障恢复

- 服务启动后直接扫描 MySQL 中未完成任务
- 百嘉瑞异步任务不再依赖 submitted 使用记录才能补查
- 已保存历史但尚未结算的任务可自动完成收尾
- 同步卡死任务超过安全时限后自动失败并退款
- 异步服务商暂时不可访问时保留任务并继续重试
- 使用记录、积分结算和历史归档均按幂等方式恢复

## V12.4 站长任务管理

- 站长后台新增全站任务列表、筛选和分页
- 显示运行中、疑似卡住、24 小时成功失败及退款统计
- 显示最近 30 天各模型成功率和平均耗时
- 支持手动运行幂等任务恢复扫描
- 支持对无生成结果的异常任务执行失败退款
- 所有人工恢复和退款操作写入审计日志

## V13.0 正式作品库

- 所有历史生成作品进入 MySQL 作品库视图
- 收藏状态支持跨设备同步
- 支持文件夹、标签和作品备注
- 支持提示词、模型、备注、文件夹和标签搜索
- 支持服务商、收藏、文件夹、标签和排序筛选
- 支持批量收藏、移动、加标签、移除标签和删除
- 删除先进入回收站，可恢复或统一清空
- 首次打开会尝试迁移浏览器本地收藏

## V13.0.1 作品库数据库兼容修复

- 自动读取 app_users.id 与 app_history_records.id 的实际排序规则
- 作品库表使用与核心外键列完全一致的排序规则
- 自动清理无数据的错误排序规则作品库残表
- 初始化失败后允许下一次请求重新尝试
- 服务端输出完整作品库初始化和查询错误日志

## V13.1.1 批量商品图工作台

- 支持 CSV 与 XLSX 批量导入商品任务
- 支持商品名、提示词、反向提示词、服务商、模型、尺寸、数量和参考图 URL
- 批量任务预检与预计积分统计
- 顺序提交、当前项完成后暂停、继续队列和失败项重试
- 浏览器本地持久化未完成批次
- 生成结果自动归档到同名作品库文件夹
- 成功图片和任务清单批量导出 ZIP

## V13.2.1 服务端批次持久化

- 批次和批次项持久化到 MySQL
- 关闭网页后由服务端继续顺序执行
- 服务重启后通过 batch_item_id 关联生成任务并断点恢复
- 支持跨设备查看、暂停、继续和失败重试
- 站长可切换查看全站批次
- 结果继续自动归入同名作品库文件夹

## V13.3 商品模板与批次复用

- 商品模板、模型参数和提示词模板保存到 MySQL
- 支持 {{商品名}}、{{原提示词}}、{{参考图URL}} 占位符
- 支持自定义 CSV/XLSX 表头映射
- 模板可跨设备读取、更新、删除和应用
- 下载导入模板时自动使用当前模板表头和示例参数
- 历史服务端批次可以复制为新草稿
- 支持复制并立即重新生产全部商品
- 重新生产会创建全新批次并按正常规则重新扣除积分

## V13.4.1 安全基线加固

- CSP、HSTS、X-Content-Type-Options、X-Frame-Options、Referrer-Policy 与 Permissions-Policy
- 会话绑定 HMAC 签名 CSRF 令牌，Vue 请求自动附加并在失效时重试
- 登录 IP 与账号双维度持久化限频，默认 5 次 / 15 分钟
- 注册 IP 持久化限频，默认 5 次 / 小时
- 普通 JSON 1MB、批次 5MB、生图 20MB 的分级请求体限制
- Provider 错误统一脱敏，服务端详情自动隐藏密钥、Token、Cookie 与图片 Data URL
- 反向代理 TRUST_PROXY 显式配置，默认不信任转发 IP
- MySQL 安全事件与限频记录：app_security_events、app_security_rate_limits
- 站长接口：/api/admin/security/summary、/api/admin/security/events

## V13.5.5 独立后台与动态 API 服务商

- 首页生成历史只显示最近 3 条
- 用户后台改为 /account 独立页面
- 前台不再显示生成任务中心
- 站长后台字体和视觉层级升级
- 站长可新增 OpenAI Images 兼容 API 服务商和模型
- API Key 使用 AES-256-GCM 加密保存
