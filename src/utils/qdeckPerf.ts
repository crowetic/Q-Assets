type QDeckPerfStatus = 'running' | 'ok' | 'error' | 'cancelled';

export type QDeckPerfPhase = {
  name: string;
  durationMs: number;
  at: number;
};

export type QDeckBoardLoadSample = {
  id: string;
  issuer: string;
  boardId: string;
  loadKey: string;
  startedAt: number;
  finishedAt?: number;
  totalMs?: number;
  status: QDeckPerfStatus;
  phases: QDeckPerfPhase[];
  meta?: Record<string, unknown>;
};

type InternalTrace = {
  sample: QDeckBoardLoadSample;
  startedPerfMs: number;
  lastPerfMs: number;
};

const LS_KEY = 'qassets_qdeck_perf';
const MAX_HISTORY = 30;

const tracesById = new Map<string, InternalTrace>();
const latestByBoard = new Map<string, QDeckBoardLoadSample>();
const history: QDeckBoardLoadSample[] = [];
const listeners = new Set<() => void>();
let sequence = 0;

const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const cloneSample = (sample: QDeckBoardLoadSample): QDeckBoardLoadSample => ({
  ...sample,
  phases: sample.phases.map((phase) => ({ ...phase })),
  meta: sample.meta ? { ...sample.meta } : undefined,
});

const getSampleBoardAliases = (sample: QDeckBoardLoadSample): string[] => {
  const aliases = new Set<string>();
  if (sample.boardId) aliases.add(sample.boardId);
  const metaBoardId = sample.meta?.boardId;
  if (typeof metaBoardId === 'string' && metaBoardId.trim()) {
    aliases.add(metaBoardId.trim());
  }
  return Array.from(aliases);
};

const setLatestSample = (sample: QDeckBoardLoadSample) => {
  const snapshot = cloneSample(sample);
  for (const boardId of getSampleBoardAliases(snapshot)) {
    latestByBoard.set(boardId, snapshot);
  }
};

const emit = () => {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
};

export const isQDeckPerfEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const qp = params.get('qdeckPerf');
    if (qp != null) {
      const enabled = ['1', 'true', 'on', 'yes'].includes(qp.toLowerCase());
      window.localStorage.setItem(LS_KEY, enabled ? '1' : '0');
      return enabled;
    }
  } catch {
    // ignore
  }
  try {
    return window.localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
};

export const setQDeckPerfEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
};

const toId = () => {
  sequence += 1;
  return `qdeck-load-${Date.now()}-${sequence}`;
};

export const beginQDeckBoardLoadTrace = (input: {
  issuer: string;
  boardId: string;
  loadKey: string;
  meta?: Record<string, unknown>;
}): string | null => {
  if (!isQDeckPerfEnabled()) return null;
  const id = toId();
  const startedAt = Date.now();
  const startedPerfMs = nowMs();
  const sample: QDeckBoardLoadSample = {
    id,
    issuer: input.issuer,
    boardId: input.boardId,
    loadKey: input.loadKey,
    startedAt,
    status: 'running',
    phases: [],
    meta: input.meta ? { ...input.meta } : undefined,
  };
  const trace: InternalTrace = {
    sample,
    startedPerfMs,
    lastPerfMs: startedPerfMs,
  };
  tracesById.set(id, trace);
  setLatestSample(sample);
  emit();
  return id;
};

export const markQDeckBoardLoadPhase = (
  traceId: string | null | undefined,
  name: string,
  meta?: Record<string, unknown>
) => {
  if (!traceId) return;
  const trace = tracesById.get(traceId);
  if (!trace) return;
  const current = nowMs();
  const durationMs = Math.max(0, current - trace.lastPerfMs);
  trace.lastPerfMs = current;
  trace.sample.phases.push({
    name,
    durationMs,
    at: Date.now(),
  });
  if (meta) {
    trace.sample.meta = { ...(trace.sample.meta || {}), ...meta };
  }
  setLatestSample(trace.sample);
  emit();
};

export const finishQDeckBoardLoadTrace = (
  traceId: string | null | undefined,
  status: Exclude<QDeckPerfStatus, 'running'> = 'ok',
  meta?: Record<string, unknown>
): QDeckBoardLoadSample | null => {
  if (!traceId) return null;
  const trace = tracesById.get(traceId);
  if (!trace) return null;
  tracesById.delete(traceId);
  const finishedPerfMs = nowMs();
  const finishedAt = Date.now();
  const totalMs = Math.max(0, finishedPerfMs - trace.startedPerfMs);
  const sample: QDeckBoardLoadSample = {
    ...trace.sample,
    status,
    finishedAt,
    totalMs,
    meta: meta ? { ...(trace.sample.meta || {}), ...meta } : trace.sample.meta,
  };
  setLatestSample(sample);
  history.unshift(cloneSample(sample));
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }
  if (status !== 'cancelled') {
    const phaseSummary = sample.phases
      .map((phase) => `${phase.name}: ${Math.round(phase.durationMs)}ms`)
      .join(' | ');
    console.info(
      `[Q-Deck perf] board=${sample.boardId} total=${Math.round(totalMs)}ms status=${sample.status}${phaseSummary ? ` | ${phaseSummary}` : ''}`
    );
  }
  emit();
  return sample;
};

export const getLatestQDeckBoardLoadSample = (boardId?: string | null) => {
  if (!boardId) return null;
  const sample = latestByBoard.get(boardId);
  return sample ? cloneSample(sample) : null;
};

export const getQDeckBoardLoadHistory = () => history.map(cloneSample);

export const subscribeQDeckBoardLoadPerf = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
