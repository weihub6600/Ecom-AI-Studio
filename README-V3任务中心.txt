Ecom AI Studio V3 MySQL 持久化任务中心补丁

功能：
1. 从 MySQL 的 app_usage_records 读取任务；
2. 显示模型、提交时间、阶段、进度、积分、失败与退款状态；
3. 生成中每 3 秒自动刷新；
4. 刷新页面后自动恢复任务；
5. 支持“重新生成”和“查看结果”；
6. 完成任务会匹配历史作品并显示首张结果图作为缩略图。

安装：
1. 将压缩包全部文件复制到 Ecom-AI-Studio 项目根目录；
2. 双击“安装V3任务中心.cmd”；
3. 构建成功后运行 npm run dev。

回滚：
双击“回滚V3任务中心.cmd”。

诊断：
node .\apply-v3-task-center.js --keep-on-build-failure
node .\apply-v3-task-center.js --skip-build

说明：
- 此补丁直接复用现有 app_usage_records，不新增重复任务表。
- 异步任务 submitted/success/failed 状态本来就保存在 MySQL，因此页面刷新后可恢复。
- 商品缩略图在任务完成并匹配到历史结果后显示；进行中的任务先显示 AI 占位缩略图。
