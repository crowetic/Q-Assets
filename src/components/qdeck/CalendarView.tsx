import * as React from 'react';
import { Box, Typography, IconButton, Stack, Chip } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

export type CalendarEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  color?: string;
  meta?: string;
};

type CalendarViewProps = {
  events: CalendarEvent[];
  initialDate?: Date;
  onEventClick?: (event: CalendarEvent) => void;
};

const pad = (n: number) => n.toString().padStart(2, '0');

const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const formatTime = (stamp: number) =>
  new Date(stamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function CalendarView({ events, initialDate, onEventClick }: CalendarViewProps) {
  const [cursor, setCursor] = React.useState<Date>(() => initialDate ?? new Date());

  const monthStart = React.useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    [cursor]
  );
  const monthEnd = React.useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
    [cursor]
  );
  const gridStart = React.useMemo(() => {
    const d = new Date(monthStart);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [monthStart]);

  const days = React.useMemo(() => {
    return Array.from({ length: 42 }).map((_, idx) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + idx);
      return d;
    });
  }, [gridStart]);

  const eventsByDay = React.useMemo(() => {
    type CalendarEventSlice = CalendarEvent & { source?: CalendarEvent };
    const map = new Map<string, CalendarEventSlice[]>();
    for (const ev of events) {
      if (!Number.isFinite(ev.start) || !Number.isFinite(ev.end)) continue;
      const startMs = Math.min(ev.start, ev.end);
      const endMs = Math.max(ev.start, ev.end);
      const startDate = new Date(startMs);
      const endDate = new Date(endMs);
      const startKey = dateKey(startDate);
      const endKey = dateKey(endDate);
      const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const last = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

      while (cursor <= last) {
        const key = dateKey(cursor);
        const dayStart = new Date(cursor);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(cursor);
        dayEnd.setHours(23, 59, 59, 999);
        const sliceStart = key === startKey ? startMs : dayStart.getTime();
        const sliceEnd = key === endKey ? endMs : dayEnd.getTime();
        const sliceAllDay =
          !!ev.allDay || (sliceStart <= dayStart.getTime() && sliceEnd >= dayEnd.getTime());

        const arr = map.get(key) ?? [];
        arr.push({
          ...ev,
          id: `${ev.id}:${key}`,
          start: sliceStart,
          end: sliceEnd,
          allDay: sliceAllDay,
          source: ev,
        });
        map.set(key, arr);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start - b.start);
    }
    return map;
  }, [events]);

  const goPrev = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goNext = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton size="small" onClick={goPrev} aria-label="Previous month">
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Typography variant="subtitle1" sx={{ minWidth: 160 }}>
            {monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Typography>
          <IconButton size="small" onClick={goNext} aria-label="Next month">
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Chip
          size="small"
          variant="outlined"
          label={`${monthStart.toLocaleDateString(undefined, {
            month: 'short',
          })} ${monthStart.getFullYear()}`}
        />
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 1,
        }}
      >
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <Typography key={label} variant="caption" sx={{ opacity: 0.7 }}>
            {label}
          </Typography>
        ))}

        {days.map((day) => {
          const key = dateKey(day);
          const inMonth = day >= monthStart && day <= monthEnd;
          const dayEvents = eventsByDay.get(key) ?? [];
          return (
            <Box
              key={key}
              sx={{
                border: (theme) => `1px solid ${theme.palette.divider}`,
                borderRadius: 1.5,
                minHeight: 120,
                p: 1,
                bgcolor: inMonth ? 'background.paper' : 'action.hover',
                opacity: inMonth ? 1 : 0.6,
                display: 'grid',
                gridTemplateRows: 'auto 1fr',
                gap: 0.5,
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {day.getDate()}
              </Typography>
              <Stack spacing={0.5} sx={{ minHeight: 0 }}>
                {dayEvents.slice(0, 4).map((ev) => (
                  <Box
                    key={ev.id}
                    onClick={() => onEventClick?.(ev.source ?? ev)}
                    sx={{
                      p: 0.5,
                      borderRadius: 1,
                      backgroundColor: ev.color ?? 'rgba(0,0,0,0.04)',
                      cursor: onEventClick ? 'pointer' : 'default',
                      display: 'grid',
                      gap: 0.25,
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {ev.allDay ? 'All day' : `${formatTime(ev.start)} - ${formatTime(ev.end)}`}
                    </Typography>
                    <Typography variant="caption" noWrap>
                      {ev.title}
                    </Typography>
                    {ev.meta && (
                      <Typography variant="caption" sx={{ opacity: 0.7 }} noWrap>
                        {ev.meta}
                      </Typography>
                    )}
                  </Box>
                ))}
                {dayEvents.length > 4 && (
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    +{dayEvents.length - 4} more…
                  </Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
