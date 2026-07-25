Ecom AI Studio V3.1 MySQL 任务中心补丁

修复内容：
1. 兼容已安装 V2.2 的分阶段进度生成流程。
2. 不再依赖固定空行定位“提交后刷新任务”。
3. 修复 UsageRecord 缺少 requestId/operationId 的 TypeScript 类型问题。
4. 任意补丁定位失败也会自动回滚。
5. 自动清理上一次失败安装遗留但未被引用的 TaskCenter.vue。

安装：
1. 将压缩包内文件复制到 Ecom-AI-Studio 项目根目录。
2. 双击“安装V3.1任务中心.cmd”。
3. 构建成功后运行 npm run dev。

注意：旧 V3 没有安装成功，不需要先运行旧回滚脚本。

诊断模式：
node .\apply-v3.1-task-center.js --keep-on-build-failure

手动回滚：
双击“回滚V3.1任务中心.cmd”
