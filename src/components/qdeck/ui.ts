import { Theme } from '@mui/material';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
// import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LowPriorityIcon from '@mui/icons-material/LowPriority';
import { TripOriginRounded } from '@mui/icons-material';
import type { Priority } from '../../types/qdeck';

export function priorityMeta(theme: Theme, p: Priority) {
  switch (p) {
    case 'CRITICAL':
      return {
        icon: ReportProblemIcon,
        bg: theme.palette.error.dark,
        fg: theme.palette.error.contrastText,
        border: theme.palette.error.main,
        label: 'critical',
      };
    case 'HIGH':
      return {
        icon: PriorityHighIcon,
        bg: theme.palette.warning.dark,
        fg: theme.palette.warning.contrastText,
        border: theme.palette.warning.main,
        label: 'high',
      };
    case 'NORMAL':
      return {
        icon: TripOriginRounded,
        bg: theme.palette.info.dark,
        fg: theme.palette.info.contrastText,
        border: theme.palette.info.main,
        label: 'normal',
      };
    case 'LOW':
    default:
      return {
        icon: LowPriorityIcon,
        bg: theme.palette.secondary.dark,
        fg: theme.palette.secondary.contrastText,
        border: theme.palette.secondary.main,
        label: 'low',
      };
  }
}

export function formatMinutes(mins?: number) {
  if (!mins || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
