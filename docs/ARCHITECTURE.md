# Ecom AI Studio V10 Architecture

## Frontend entry

`web/src/main.ts` 根据路径选择应用：

- `/`：创作工作台 `App.vue`
- `/admin`：独立站长后台 `AdminApp.vue`

站长后台不依赖额外路由库，使用同一份 Vite 构建和 Express SPA 回退。

## Admin modules

```text
web/src/
├─ AdminApp.vue
├─ admin-page.css
├─ api/client.ts
├─ types.ts
└─ utils/format.ts
```

后台提供总览、用户、卡密、模型和审计五个工作区，列表均由 MySQL 分页查询，不再一次加载数百条记录。

## Backend modules

```text
server/src/
├─ routes/admin.routes.ts
├─ services/
│  ├─ admin-query.ts
│  ├─ audit-log.ts
│  ├─ model-settings.ts
│  └─ async-reconciliation.ts
├─ db/schema.ts
├─ pricing.ts
└─ server.ts
```

`model-settings.ts` 在启动时将代码中注册的模型同步到 `app_model_settings`。站长修改价格后，前台模型列表、个人价格表和下一次生成扣费均读取同一数据源。

`audit-log.ts` 记录站长的重要写操作。`admin-query.ts` 负责看板聚合、搜索、筛选和分页，避免在账号业务服务中堆积后台展示查询。

## Compatibility

V10 保持 V8/V9 的用户、会话、积分、卡密、使用记录、历史记录和图片表不变，只新增：

```text
app_model_settings
app_admin_audit_logs
```

现有用户数据和生成图片不需要重新迁移。
