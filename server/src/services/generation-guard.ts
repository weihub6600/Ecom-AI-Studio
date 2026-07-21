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