import { useSyncExternalStore } from 'react';
import { BatchPublishResource } from '../utils/useQdnBatchPublisher';
import {
  PublishJobProgress,
  PublishThrottleContext,
  publishResourcesWithProgress,
  PublishJobError,
} from '../utils/qdnProgressivePublisher';

type PublishQueueJobBase = {
  id: string;
  label?: string;
  createdAt: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: PublishJobProgress | null;
  error?: string;
};

export type PublishThrottleState = {
  context: PublishThrottleContext;
  secondsLeft: number;
  resume: () => void;
  cancel: () => void;
};

type QdnJobPayload = {
  kind: 'qdn';
  resources: BatchPublishResource[];
  chunkSize?: number;
  throttleDelayMs?: number;
};

type QmailJobPayload = {
  kind: 'qmail';
  resources: BatchPublishResource[];
  chunkSize?: number;
  throttleDelayMs?: number;
  fallbackPublicKeys: string[];
  identifierKeyMap: Record<string, string>;
  chunkTimeoutPerResourceMs?: number;
};

type PublishQueueJob = PublishQueueJobBase & {
  payload: QdnJobPayload | QmailJobPayload;
  throttle: PublishThrottleState | null;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
  rejectCompletion: (error: Error) => void;
};

type PersistedJob = {
  id: string;
  label?: string;
  createdAt: number;
  payload: QdnJobPayload | QmailJobPayload;
};

type PublishQueueSnapshot = {
  jobs: PublishQueueJob[];
  activeJobId?: string;
};

const STORAGE_KEY = 'qassets_publish_queue_v1';

const listeners = new Set<() => void>();
const hasWindow = typeof window !== 'undefined';

const isQmailPayload = (payload: QdnJobPayload | QmailJobPayload): payload is QmailJobPayload =>
  payload.kind === 'qmail';

const createQueueJob = (
  payload: QdnJobPayload | QmailJobPayload,
  meta?: {
    id?: string;
    label?: string;
    createdAt?: number;
    status?: PublishQueueJob['status'];
  }
): PublishQueueJob => {
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: Error) => void;
  const completionPromise = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    id: meta?.id ?? generateId(),
    label: meta?.label,
    createdAt: meta?.createdAt ?? Date.now(),
    status: meta?.status ?? 'pending',
    progress: null,
    throttle: null,
    payload,
    completionPromise,
    resolveCompletion,
    rejectCompletion,
  };
};

const createSnapshot = (): PublishQueueSnapshot => ({
  jobs: [],
  activeJobId: undefined,
});

const snapshot: PublishQueueSnapshot = createSnapshot();

let processing = false;

const notify = () => {
  listeners.forEach((listener) => listener());
};

const persist = () => {
  if (!hasWindow) return;
  try {
    const serializable = snapshot.jobs
      .filter((job) => job.status === 'pending')
      .map((job) => ({
        id: job.id,
        label: job.label,
        createdAt: job.createdAt,
        payload: job.payload,
      }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    /* ignore */
  }
};

const loadPersistedJobs = () => {
  if (!hasWindow) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((item: PersistedJob) => {
      if (!item || typeof item !== 'object' || !Array.isArray(item.payload?.resources)) return;
      const job = createQueueJob(item.payload, {
        id: item.id,
        label: item.label,
        createdAt: item.createdAt || Date.now(),
      });
      snapshot.jobs.push(job);
    });
  } catch {
    /* ignore */
  }
};

const generateId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const updateJob = (jobId: string, updater: (job: PublishQueueJob) => void) => {
  const job = snapshot.jobs.find((j) => j.id === jobId);
  if (!job) return;
  updater(job);
  notify();
};

const cleanupJob = (jobId: string) => {
  const idx = snapshot.jobs.findIndex((j) => j.id === jobId);
  if (idx >= 0) {
    snapshot.jobs.splice(idx, 1);
  }
  if (snapshot.activeJobId === jobId) {
    snapshot.activeJobId = undefined;
  }
  persist();
  notify();
};

const startNextJob = async () => {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const nextJob = snapshot.jobs.find((j) => j.status === 'pending');
      if (!nextJob) break;
      await runJob(nextJob);
    }
  } finally {
    processing = false;
  }
};

loadPersistedJobs();
if (snapshot.jobs.length) {
  startNextJob();
}

if (snapshot.jobs.length) {
  startNextJob();
}

const startThrottleCountdown = (
  job: PublishQueueJob,
  ctx: PublishThrottleContext,
  resolve: (value: boolean) => void
) => {
  if (!hasWindow) {
    resolve(true);
    return;
  }

  let resolved = false;
  const interval = window.setInterval(() => {
    updateJob(job.id, (target) => {
      if (!target.throttle) return;
      const next = target.throttle.secondsLeft - 1;
      target.throttle = { ...target.throttle, secondsLeft: Math.max(0, next) };
      if (next <= 0 && !resolved) {
        resolved = true;
        window.clearInterval(interval);
        target.throttle = null;
        resolve(true);
      }
    });
  }, 1000);

  job.throttle = {
    context: ctx,
    secondsLeft: Math.ceil(ctx.delayMs / 1000),
    resume: () => {
      if (resolved) return;
      resolved = true;
      if (hasWindow) window.clearInterval(interval);
      updateJob(job.id, (target) => {
        target.throttle = null;
      });
      resolve(true);
    },
    cancel: () => {
      if (resolved) return;
      resolved = true;
      if (hasWindow) window.clearInterval(interval);
      updateJob(job.id, (target) => {
        target.throttle = null;
      });
      resolve(false);
    },
  };
  notify();
};

const runJob = async (job: PublishQueueJob) => {
  snapshot.activeJobId = job.id;
  job.status = 'running';
  job.progress = null;
  job.throttle = null;
  notify();

  const abortController = new AbortController();

  const handleProgress = (progress: PublishJobProgress) => {
    updateJob(job.id, (target) => {
      target.progress = progress;
    });
  };

  const handleThrottle = (ctx: PublishThrottleContext) =>
    new Promise<boolean>((resolve) => {
      updateJob(job.id, (target) => {
        startThrottleCountdown(target, ctx, resolve);
      });
    });

  const execOptions: Parameters<typeof publishResourcesWithProgress>[1] = {
    chunkSize: job.payload.chunkSize,
    throttleDelayMs: job.payload.throttleDelayMs,
    signal: abortController.signal,
    onProgress: handleProgress,
    onThrottle: handleThrottle,
  };

  if (isQmailPayload(job.payload)) {
    const qmailPayload = job.payload;
    execOptions.executeChunk = async (chunk) => {
      const identifierMap = qmailPayload.identifierKeyMap;
      const chunkKeys = new Set<string>();
      chunk.forEach((resource) => {
        const key = identifierMap[resource.identifier];
        if (key) chunkKeys.add(key);
      });
      const keys = chunkKeys.size ? Array.from(chunkKeys) : qmailPayload.fallbackPublicKeys;
      const perResource = qmailPayload.chunkTimeoutPerResourceMs ?? 12e5;
      const timeoutMs = Math.max(perResource, chunk.length * perResource);
      await qortalRequestWithTimeout(
        {
          action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
          resources: chunk,
          encrypt: true,
          publicKeys: keys,
        },
        timeoutMs
      );
    };
  }

  try {
    await publishResourcesWithProgress(
      {
        label: job.label,
        resources: job.payload.resources,
      },
      execOptions
    );
    job.status = 'completed';
    job.progress = null;
    job.resolveCompletion();
  } catch (error: any) {
    job.status = 'error';
    job.error = error instanceof PublishJobError ? error.message : error?.message || String(error);
    job.rejectCompletion(
      error instanceof Error ? error : new Error(error?.message || String(error))
    );
  } finally {
    snapshot.activeJobId = undefined;
    job.progress = null;
    job.throttle = null;
    cleanupJob(job.id);
  }
};

export const enqueueQdnPublishJob = (params: {
  label?: string;
  resources: BatchPublishResource[];
  chunkSize?: number;
  throttleDelayMs?: number;
}) => {
  if (!params.resources.length) return null;
  const job = createQueueJob(
    {
      kind: 'qdn',
      resources: params.resources,
      chunkSize: params.chunkSize,
      throttleDelayMs: params.throttleDelayMs,
    },
    { label: params.label }
  );
  snapshot.jobs.push(job);
  persist();
  notify();
  startNextJob();
  return { id: job.id, completion: job.completionPromise };
};

export const enqueueQmailPublishJob = (params: {
  label?: string;
  resources: BatchPublishResource[];
  fallbackPublicKeys: string[];
  identifierKeyMap: Record<string, string>;
  chunkSize?: number;
  throttleDelayMs?: number;
  chunkTimeoutPerResourceMs?: number;
}) => {
  if (!params.resources.length) return null;
  const job = createQueueJob(
    {
      kind: 'qmail',
      resources: params.resources,
      chunkSize: params.chunkSize,
      throttleDelayMs: params.throttleDelayMs,
      fallbackPublicKeys: params.fallbackPublicKeys,
      identifierKeyMap: params.identifierKeyMap,
      chunkTimeoutPerResourceMs: params.chunkTimeoutPerResourceMs,
    },
    { label: params.label }
  );
  snapshot.jobs.push(job);
  persist();
  notify();
  startNextJob();
  return { id: job.id, completion: job.completionPromise };
};

export const usePublishQueue = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );

export const resumeThrottledJob = (jobId: string) => {
  const job = snapshot.jobs.find((j) => j.id === jobId);
  job?.throttle?.resume();
};

export const cancelThrottledJob = (jobId: string) => {
  const job = snapshot.jobs.find((j) => j.id === jobId);
  job?.throttle?.cancel();
};
