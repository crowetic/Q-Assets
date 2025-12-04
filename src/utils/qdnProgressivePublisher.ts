import { BatchPublishResource, publishQdnResources } from './useQdnBatchPublisher';

export type PublishJobStatus =
  | 'pending'
  | 'publishing'
  | 'waiting'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface PublishJobProgress {
  jobId: string;
  label?: string;
  status: PublishJobStatus;
  totalResources: number;
  completedResources: number;
  totalChunks: number;
  completedChunks: number;
  currentChunkSize: number;
  chunkIndex: number;
  attempt: number;
  lastError?: unknown;
}

export interface PublishJobDefinition {
  id?: string;
  label?: string;
  resources: BatchPublishResource[];
}

export interface PublishThrottleContext extends PublishJobProgress {
  delayMs: number;
  error: unknown;
}

export type PublishChunkExecutor = (
  chunk: BatchPublishResource[],
  context: { chunkIndex: number; attempt: number }
) => Promise<void>;

export interface PublishJobOptions {
  chunkSize?: number;
  throttleDelayMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: PublishJobProgress) => void;
  onThrottle?: (context: PublishThrottleContext) => Promise<boolean> | boolean;
  executeChunk?: PublishChunkExecutor;
}

const DEFAULT_THROTTLE_DELAY_MS = 60_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const buildJobId = () =>
  `publish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function chunkResources<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items.slice()];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

const extractMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.toString();
  if (typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isTooManyUnconfirmed = (error: unknown) => {
  const message = extractMessage(error).toLowerCase();
  return (
    message.includes('too many unconfirmed') ||
    message.includes('too_many_unconfirmed') ||
    message.includes('too-many-unconfirmed')
  );
};

export const isTooManyUnconfirmedError = isTooManyUnconfirmed;

export class PublishJobError extends Error {
  readonly chunkIndex: number;
  readonly attempt: number;
  readonly progress: PublishJobProgress;
  readonly originalError?: unknown;

  constructor(
    message: string,
    info: {
      chunkIndex: number;
      attempt: number;
      progress: PublishJobProgress;
      originalError?: unknown;
    }
  ) {
    super(message);
    this.name = 'PublishJobError';
    this.chunkIndex = info.chunkIndex;
    this.attempt = info.attempt;
    this.progress = info.progress;
    this.originalError = info.originalError;
  }
}

const throwCancelledError = (
  chunkIndex: number,
  attempt: number,
  currentChunkSize: number,
  progressFactory: (
    status: PublishJobStatus,
    extras?: Partial<PublishJobProgress>
  ) => PublishJobProgress,
  onProgress?: PublishJobOptions['onProgress'],
  reason: unknown = 'Publishing cancelled'
) => {
  const progress = progressFactory('cancelled', {
    chunkIndex,
    attempt,
    currentChunkSize,
    lastError: reason,
  });
  onProgress?.(progress);
  throw new PublishJobError(extractMessage(reason) || 'Publishing cancelled', {
    chunkIndex,
    attempt,
    progress,
    originalError: reason,
  });
};

/**
 * Publish a batch of QDN resources in deterministic chunks while reporting progress.
 * The helper mirrors Q-Tube / Quitter behaviour by retrying when the Core node
 * responds with "too many unconfirmed" and allowing callers to hook into progress updates.
 *
 * Example:
 * ```ts
 * await publishResourcesWithProgress(
 *   { label: 'Video uploads', resources: myResources },
 *   {
 *     chunkSize: 1,
 *     onProgress: (state) => console.log(state.status, state.completedResources),
 *     onThrottle: ({ delayMs }) => notifyUserAboutDelay(delayMs),
 *   }
 * );
 * ```
 */
export async function publishResourcesWithProgress(
  job: PublishJobDefinition,
  options: PublishJobOptions = {}
): Promise<void> {
  const { resources, label } = job;
  const jobId = job.id || buildJobId();
  const chunkSizeFromOptions = (options.chunkSize ?? resources.length) || 1;
  const safeChunkSize = Math.max(1, chunkSizeFromOptions);
  const chunks = chunkResources(resources, safeChunkSize);
  const totalResources = resources.length;
  const totalChunks = chunks.length;

  let completedChunks = 0;
  let completedResources = 0;

  const getProgress = (
    status: PublishJobStatus,
    ctx: Partial<{
      chunkIndex: number;
      attempt: number;
      currentChunkSize: number;
      lastError?: unknown;
    }> = {}
  ): PublishJobProgress => ({
    jobId,
    label,
    status,
    totalResources,
    completedResources,
    totalChunks,
    completedChunks,
    currentChunkSize: ctx.currentChunkSize ?? 0,
    chunkIndex: ctx.chunkIndex ?? 0,
    attempt: ctx.attempt ?? 0,
    lastError: ctx.lastError,
  });

  const emitProgress = (progress: PublishJobProgress) => {
    options.onProgress?.(progress);
    return progress;
  };

  if (!totalResources) {
    emitProgress(
      getProgress('completed', {
        chunkIndex: 0,
        attempt: 0,
        currentChunkSize: 0,
      })
    );
    return;
  }

  emitProgress(
    getProgress('pending', {
      chunkIndex: 0,
      attempt: 0,
      currentChunkSize: chunks[0]?.length ?? 0,
    })
  );

  const ensureNotCancelled = (chunkIndex: number, attempt: number) => {
    if (!options.signal?.aborted) return;
    const chunkSize = chunks[Math.min(chunkIndex, chunks.length - 1)]?.length ?? 0;
    throwCancelledError(chunkIndex, attempt, chunkSize, getProgress, options.onProgress);
  };

  const executeChunk =
    options.executeChunk ??
    (async (chunk: BatchPublishResource[]) => {
      await publishQdnResources(chunk);
    });

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    let attempt = 0;

    while (true) {
      attempt += 1;
      ensureNotCancelled(chunkIndex, attempt);

      emitProgress(
        getProgress('publishing', {
          chunkIndex,
          attempt,
          currentChunkSize: chunk.length,
        })
      );

      try {
        await executeChunk(chunk, { chunkIndex, attempt });
        completedChunks += 1;
        completedResources += chunk.length;

        emitProgress(
          getProgress('publishing', {
            chunkIndex,
            attempt,
            currentChunkSize: chunk.length,
          })
        );
        break;
      } catch (error) {
        ensureNotCancelled(chunkIndex, attempt);
        if (isTooManyUnconfirmed(error)) {
          const delayMs = options.throttleDelayMs ?? DEFAULT_THROTTLE_DELAY_MS;
          const waitingProgress = getProgress('waiting', {
            chunkIndex,
            attempt,
            currentChunkSize: chunk.length,
            lastError: error,
          });
          const shouldContinue =
            (await options.onThrottle?.({ ...waitingProgress, delayMs, error })) ?? true;
          emitProgress(waitingProgress);
          if (!shouldContinue) {
            throwCancelledError(
              chunkIndex,
              attempt,
              chunk.length,
              getProgress,
              options.onProgress,
              error
            );
          }
          await delay(delayMs);
          continue;
        }

        const errorProgress = getProgress('error', {
          chunkIndex,
          attempt,
          currentChunkSize: chunk.length,
          lastError: error,
        });
        emitProgress(errorProgress);
        throw new PublishJobError('Failed to publish QDN resources', {
          chunkIndex,
          attempt,
          progress: errorProgress,
          originalError: error,
        });
      }
    }
  }

  emitProgress(
    getProgress('completed', {
      chunkIndex: totalChunks,
      attempt: 0,
      currentChunkSize: 0,
    })
  );
}

export const PublishHelperUtils = {
  isTooManyUnconfirmed,
  extractMessage,
};
