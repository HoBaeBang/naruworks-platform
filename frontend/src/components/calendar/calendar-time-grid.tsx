import type { CalendarEvent } from "@/types/calendar";
import { formatCompactLunarDate, formatLunarDate, getCalendarDateTextClass, getCalendarDayMetadata, getCalendarWeekdayTextClass } from "@/lib/calendar-date-style";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";
import Link from "next/link";

const START_HOUR = 0;
const END_HOUR = 24;

export function CalendarTimeGrid({
  days,
  events,
  view,
  dayMetadataByDate,
}: {
  days: Date[];
  events: CalendarEvent[];
  view: "week" | "day";
  dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata>;
}) {
  const supportsCompactWeek = view === "week" && days.length === 7;

  return (
    <>
      <div className={supportsCompactWeek ? "max-[479px]:hidden" : undefined}>
        <TimeGridContent days={days} events={events} view={view} dayMetadataByDate={dayMetadataByDate} />
      </div>
      {supportsCompactWeek && (
        <div className="hidden max-[479px]:block">
          <TimeGridContent days={days} events={events} view={view} dayMetadataByDate={dayMetadataByDate} compact />
        </div>
      )}
    </>
  );
}

function TimeGridContent({
  days,
  events,
  view,
  dayMetadataByDate,
  compact = false,
}: {
  days: Date[];
  events: CalendarEvent[];
  view: "week" | "day";
  dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata>;
  compact?: boolean;
}) {
  const hourHeight = compact ? 32 : 48;
  const gridHeight = (END_HOUR - START_HOUR) * hourHeight;
  const gridColumns = compact
    ? `1.75rem repeat(${days.length}, minmax(0, 1fr))`
    : `3.5rem repeat(${days.length}, minmax(${days.length === 1 ? "16rem" : "7.5rem"}, 1fr))`;

  return (
    <section className={`overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] ${compact ? "overflow-x-hidden rounded-none border-x-0" : ""}`}>
      <div className={compact ? "min-w-0" : "min-w-[22rem]"} style={{ display: "grid", gridTemplateColumns: gridColumns }}>
        <div className="border-b border-[var(--border)]" />
        {days.map((day) => (
          <DayHeader key={day.toISOString()} day={day} view={view} metadata={getCalendarDayMetadata(dayMetadataByDate, day)} compact={compact} />
        ))}

        <div className={`border-b border-[var(--border)] text-xs font-bold text-[var(--muted)] ${compact ? "px-0 py-2 text-center text-[8px]" : "px-2 py-3"}`}>종일</div>
        {days.map((day) => (
          <div key={`${day.toISOString()}-all-day`} className={`border-b border-l border-[var(--border)] ${compact ? "min-h-11 p-0.5" : "min-h-14 p-2"}`}>
            {eventsForDay(events, day)
              .filter((event) => event.allDay)
              .slice(0, compact ? 1 : 2)
              .map((event) => (
                <EventLink key={event.occurrenceKey} event={event} day={day} view={view} allDay compact={compact} />
              ))}
          </div>
        ))}

        <div className="relative border-r border-[var(--border)]" style={{ height: gridHeight }}>
          {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
            <div key={index} className={`absolute text-[var(--muted)] ${compact ? "right-0.5 text-[7px]" : "right-2 text-[10px]"}`} style={{ top: index * hourHeight - (compact ? 5 : 7) }}>
              {String(START_HOUR + index).padStart(2, "0")}
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={`${day.toISOString()}-timed`} className="relative border-r border-[var(--border)]" style={{ height: gridHeight }}>
            {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
              <div key={index} className="absolute inset-x-0 border-t border-[var(--border)]" style={{ top: index * hourHeight }} />
            ))}
            {eventsForDay(events, day)
              .filter((event) => !event.allDay)
              .map((event) => (
                <TimedEventLink key={event.occurrenceKey} event={event} day={day} view={view} hourHeight={hourHeight} compact={compact} />
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function DayHeader({ day, view, metadata, compact }: { day: Date; view: "week" | "day"; metadata?: CalendarDayMetadata; compact: boolean }) {
  if (compact) {
    return (
      <Link
        href={`/calendar?view=${view}&date=${formatDate(day)}&mode=create`}
        aria-label={`${formatDate(day)} 새 일정 만들기`}
        className="flex min-h-14 flex-col items-center justify-center border-b border-l border-[var(--border)] py-1"
      >
        <span className={`text-[10px] font-bold ${getCalendarWeekdayTextClass(day.getDay())}`}>{weekdayLabel(day)}</span>
        <span className={`mt-0.5 text-sm font-semibold ${getCalendarDateTextClass(day, metadata)}`}>{day.getDate()}</span>
        <span className="text-[8px] font-medium text-[var(--muted)]">{formatCompactLunarDate(metadata)}</span>
      </Link>
    );
  }

  return (
    <div className="flex min-h-16 items-center justify-between border-b border-l border-[var(--border)] px-3">
      <div className="min-w-0">
        <p className={`text-xs font-bold ${getCalendarWeekdayTextClass(day.getDay())}`}>{weekdayLabel(day)}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className={`text-lg font-semibold ${getCalendarDateTextClass(day, metadata)}`}>{day.getDate()}</p>
          <p className="text-[10px] font-medium text-[var(--muted)]">{formatLunarDate(metadata)}</p>
        </div>
        {metadata?.holidayName && <p className="truncate text-[10px] font-semibold text-[#d9363e]">{metadata.holidayName}</p>}
      </div>
      <Link
        href={`/calendar?view=${view}&date=${formatDate(day)}&mode=create`}
        aria-label={`${formatDate(day)} 새 일정 만들기`}
        title="새 일정"
        className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] text-lg text-[var(--muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
      >
        +
      </Link>
    </div>
  );
}

function TimedEventLink({ event, day, view, hourHeight, compact }: { event: CalendarEvent; day: Date; view: "week" | "day"; hourHeight: number; compact: boolean }) {
  const startAt = new Date(event.startAt);
  const endAt = new Date(event.endAt);
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const visibleStart = startAt > dayStart ? startAt : dayStart;
  const visibleEnd = endAt < dayEnd ? endAt : dayEnd;
  const top = Math.max(0, (visibleStart.getHours() - START_HOUR) * hourHeight + visibleStart.getMinutes() * (hourHeight / 60));
  const height = Math.max(compact ? 24 : 28, (visibleEnd.getTime() - visibleStart.getTime()) / 60000 * (hourHeight / 60));

  return <EventLink event={event} day={day} view={view} compact={compact} style={{ top, height, borderColor: event.color }} />;
}

function EventLink({
  event,
  day,
  view,
  allDay = false,
  compact = false,
  style,
}: {
  event: CalendarEvent;
  day: Date;
  view: "week" | "day";
  allDay?: boolean;
  compact?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <Link
      href={`/calendar?view=${view}&date=${formatDate(day)}&occurrenceKey=${encodeURIComponent(event.occurrenceKey)}&mode=${event.readOnly ? "detail" : "edit"}`}
      className={[
        allDay
          ? `mb-1 block overflow-hidden rounded-md text-[#062b20] ${compact ? "max-h-6 px-0.5 py-0 text-[9px] leading-3" : "truncate px-2 py-1 text-xs"}`
          : `absolute overflow-hidden rounded-md border bg-[var(--surface)] text-[var(--foreground)] ${compact ? "inset-x-0.5 px-0.5 py-0 text-[9px] leading-3" : "inset-x-1 px-2 py-1 text-xs"}`,
        "font-semibold",
      ].join(" ")}
      style={allDay ? { backgroundColor: event.color } : style}
      title={event.title}
    >
      {!allDay && !compact && <span className="block text-[10px] font-medium text-[var(--muted)]">{formatTimeRange(event)}</span>}
      <span className={compact ? "block max-h-6 overflow-hidden" : "block truncate"}>{event.title}</span>
    </Link>
  );
}

function eventsForDay(events: CalendarEvent[], day: Date) {
  return events
    .filter((event) => new Date(event.startAt) <= endOfDay(day) && new Date(event.endAt) > startOfDay(day))
    .sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
      return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
    });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0);
}

function weekdayLabel(date: Date) {
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTimeRange(event: CalendarEvent) {
  return `${event.startAt.slice(11, 16)} - ${event.endAt.slice(11, 16)}`;
}
