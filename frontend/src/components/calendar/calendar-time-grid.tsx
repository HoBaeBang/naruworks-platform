import type { CalendarEvent } from "@/types/calendar";
import Link from "next/link";

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 48;

export function CalendarTimeGrid({
  days,
  events,
  view,
}: {
  days: Date[];
  events: CalendarEvent[];
  view: "week" | "day";
}) {
  const gridColumns = `3.5rem repeat(${days.length}, minmax(${days.length === 1 ? "16rem" : "7.5rem"}, 1fr))`;

  return (
    <section className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="min-w-[22rem]" style={{ display: "grid", gridTemplateColumns: gridColumns }}>
        <div className="border-b border-[var(--border)]" />
        {days.map((day) => (
          <div key={day.toISOString()} className="flex min-h-16 items-center justify-between border-b border-l border-[var(--border)] px-3">
            <div>
              <p className="text-xs font-bold text-[var(--muted)]">{weekdayLabel(day)}</p>
              <p className="mt-1 text-lg font-semibold">{day.getDate()}</p>
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
        ))}

        <div className="border-b border-[var(--border)] px-2 py-3 text-xs font-bold text-[var(--muted)]">종일</div>
        {days.map((day) => (
          <div key={`${day.toISOString()}-all-day`} className="min-h-14 border-b border-l border-[var(--border)] p-2">
            {eventsForDay(events, day)
              .filter((event) => event.allDay)
              .slice(0, 2)
              .map((event) => (
                <EventLink key={event.occurrenceKey} event={event} day={day} view={view} allDay />
              ))}
          </div>
        ))}

        <div className="relative h-[1152px] border-r border-[var(--border)]">
          {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
            <div key={index} className="absolute right-2 text-[10px] text-[var(--muted)]" style={{ top: index * HOUR_HEIGHT - 7 }}>
              {String(START_HOUR + index).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={`${day.toISOString()}-timed`} className="relative h-[1152px] border-r border-[var(--border)]">
            {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
              <div key={index} className="absolute inset-x-0 border-t border-[var(--border)]" style={{ top: index * HOUR_HEIGHT }} />
            ))}
            {eventsForDay(events, day)
              .filter((event) => !event.allDay)
              .map((event) => (
                <TimedEventLink key={event.occurrenceKey} event={event} day={day} view={view} />
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function TimedEventLink({ event, day, view }: { event: CalendarEvent; day: Date; view: "week" | "day" }) {
  const startAt = new Date(event.startAt);
  const endAt = new Date(event.endAt);
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const visibleStart = startAt > dayStart ? startAt : dayStart;
  const visibleEnd = endAt < dayEnd ? endAt : dayEnd;
  const top = Math.max(0, (visibleStart.getHours() - START_HOUR) * HOUR_HEIGHT + visibleStart.getMinutes() * (HOUR_HEIGHT / 60));
  const height = Math.max(28, (visibleEnd.getTime() - visibleStart.getTime()) / 60000 * (HOUR_HEIGHT / 60));

  return (
    <EventLink event={event} day={day} view={view} style={{ top, height, borderColor: event.color }} />
  );
}

function EventLink({
  event,
  day,
  view,
  allDay = false,
  style,
}: {
  event: CalendarEvent;
  day: Date;
  view: "week" | "day";
  allDay?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <Link
      href={`/calendar?view=${view}&date=${formatDate(day)}&occurrenceKey=${encodeURIComponent(event.occurrenceKey)}&mode=edit`}
      className={[
        allDay
          ? "mb-1 block truncate rounded-md px-2 py-1 text-xs font-semibold text-[#062b20]"
          : "absolute inset-x-1 overflow-hidden rounded-md border bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--foreground)]",
      ].join(" ")}
      style={allDay ? { backgroundColor: event.color } : style}
      title={event.title}
    >
      {!allDay && <span className="block text-[10px] font-medium text-[var(--muted)]">{formatTimeRange(event)}</span>}
      <span className="block truncate">{event.title}</span>
    </Link>
  );
}

function eventsForDay(events: CalendarEvent[], day: Date) {
  return events
    .filter((event) => new Date(event.startAt) <= endOfDay(day) && new Date(event.endAt) > startOfDay(day))
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
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
