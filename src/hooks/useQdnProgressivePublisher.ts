import { useCallback, useEffect, useState } from 'react';
import {
  publishResourcesWithProgress,
  type PublishJobDefinition,
  type PublishJobOptions,
  type PublishJobProgress,
  type PublishThrottleContext,
} from '../utils/qdnProgressivePublisher';

export type PublishThrottleState = {
  context: PublishThrottleContext;
  secondsLeft: number;
  resume: () => void;
  cancel: () => void;
};

export function useQdnProgressivePublisher() {
  const [progress, setProgress] = useState<PublishJobProgress | null>(null);
  const [throttle, setThrottle] = useState<PublishThrottleState | null>(null);

  useEffect(() => {
    if (!throttle) return;
    if (throttle.secondsLeft <= 0) {
      throttle.resume();
      return;
    }

    const id = setInterval(() => {
      setThrottle((prev) => {
        if (!prev) return prev;
        if (prev.secondsLeft <= 1) {
          prev.resume();
          return null;
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);

    return () => clearInterval(id);
  }, [throttle]);

  const publish = useCallback(async (job: PublishJobDefinition, options?: PublishJobOptions) => {
    const { onProgress, onThrottle, ...rest } = options || {};
    setProgress(null);

    const handleProgress = (ctx: PublishJobProgress) => {
      setProgress(ctx);
      onProgress?.(ctx);
    };

    const handleThrottle = async (ctx: PublishThrottleContext) => {
      if (onThrottle) {
        const decision = await onThrottle(ctx);
        if (decision === false) return false;
      }

      return new Promise<boolean>((resolve) => {
        const resolveAndClear = (value: boolean) => {
          resolve(value);
          setThrottle(null);
        };

        setThrottle({
          context: ctx,
          secondsLeft: Math.ceil(ctx.delayMs / 1000),
          resume: () => resolveAndClear(true),
          cancel: () => resolveAndClear(false),
        });
      });
    };

    try {
      await publishResourcesWithProgress(job, {
        ...rest,
        onProgress: handleProgress,
        onThrottle: handleThrottle,
      });
    } finally {
      setProgress(null);
      setThrottle(null);
    }
  }, []);

  return { publish, progress, throttle };
}
