import type {
  HistoryProviderId,
  HistoryService,
  StoredHistoryRecord
} from "../history.js";
import type { AppDatabase } from "../db/database.js";
import type {
  GenerateImageResult
} from "../types.js";
import {
  updateGenerationTask
} from "./generation-tasks.js";

export interface ArchiveGenerationResultInput {
  database: AppDatabase;
  historyService: HistoryService;
  taskId: string;
  userId: string;
  username: string;
  provider: HistoryProviderId;
  providerName: string;
  model: string;
  prompt: string;
  operation:
    | "text-to-image"
    | "image-edit";
  size: string;
  result: GenerateImageResult;
  clientIp?: string;
  userAgent?: string;
}

export async function archiveGenerationResult(
  input: ArchiveGenerationResultInput
): Promise<StoredHistoryRecord> {
  await updateGenerationTask(
    input.database,
    input.taskId,
    {
      status: "running",
      stage: "downloading",
      progress: 92,
      providerProgress:
        "正在下载生成图片"
    }
  );

  const historyRecord =
    await input.historyService.save(
      {
        clientId: input.userId,
        generationTaskId: input.taskId,
        provider: input.provider,
        providerName: input.providerName,
        model: input.model,
        prompt: input.prompt,
        operation: input.operation,
        size: input.size,
        durationMs:
          input.result.durationMs,
        cost: input.result.cost,
        images: input.result.images
      },
      {
        ownerUsername: input.username,
        clientIp: input.clientIp,
        userAgent: input.userAgent
      }
    );

  await updateGenerationTask(
    input.database,
    input.taskId,
    {
      status: "running",
      stage: "saving",
      progress: 96,
      historyId:
        historyRecord.id,
      providerProgress:
        "生成结果已保存到作品历史"
    }
  );

  return historyRecord;
}
