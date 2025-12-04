import QdnPublishStatus from './QdnPublishStatus';
import { usePublishQueue } from '../../state/publishQueue';

type Props = {
  fallbackLabel?: string;
};

export default function PublishQueueStatus({ fallbackLabel }: Props) {
  const state = usePublishQueue();
  const activeJob = state.activeJobId
    ? state.jobs.find((job) => job.id === state.activeJobId)
    : null;

  if (!activeJob) return null;

  return (
    <QdnPublishStatus
      progress={activeJob.progress}
      throttle={activeJob.throttle}
      contextLabel={activeJob.label || fallbackLabel}
    />
  );
}
