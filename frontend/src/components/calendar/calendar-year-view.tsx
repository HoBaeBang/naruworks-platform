import type { CalendarEvent } from "@/types/calendar";
import { getCalendarDateTextClass, getCalendarDayMetadata, getCalendarWeekdayTextClass } from "@/lib/calendar-date-style";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";
import Link from "next/link";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function CalendarYearView({ year, events, dayMetadataByDate }: { year: number; events: CalendarEvent[]; dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata> }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="grid md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 12 }, (_, monthIndex) => (
          <MiniMonth key={monthIndex} year={year} month={monthIndex} events={events} dayMetadataByDate={dayMetadataByDate} />
        ))}
      </div>
    </section>
  );
}

function MiniMonth({ year, month, events, dayMetadataByDate }: { year: number; month: number; events: CalendarEvent[]; dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata> }) {
  const firstDay = new Date(year, month, 1);
  const days = Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => new Date(year, month, index + 1));

  return (
    <article className="border-b border-r border-[var(--border)] p-4 last:border-b-0">
      <h2 className="text-base font-semibold">{month + 1}월</h2>
      <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-bold text-[var(--muted)]">
        {WEEKDAYS.map((weekday, index) => <span key={weekday} className={getCalendarWeekdayTextClass(index)}>{weekday}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-1">
        {Array.from({ length: firstDay.getDay() }, (_, index) => <span key={`blank-${index}`} />)}
        {days.map((day) => {
          const dayEvents = eventsForDay(events, day);
          const metadata = getCalendarDayMetadata(dayMetadataByDate, day);
          return (
            <Link
              key={day.toISOString()}
              href={`/calendar?view=day&date=${formatDate(day)}`}
              aria-label={`${formatDate(day)} 일간 보기`}
              className={[
                "flex min-h-9 flex-col items-center justify-center rounded-md transition hover:bg-[var(--primary-soft)]",
                isToday(day) ? "bg-[var(--primary-soft)]" : "",
              ].join(" ")}
              title={metadata?.holidayName ?? undefined}
            >
              <span className={`text-xs font-semibold ${getCalendarDateTextClass(day, metadata)}`}>{day.getDate()}</span>
              <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.occurrenceKey}
                    className={event.allDay ? "h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-full border"}
                    style={event.allDay ? { backgroundColor: event.color } : { borderColor: event.color }}
                  />
                ))}
              </span>
            </Link>
          );
        })}
      </div>
    </article>
  );
}

function eventsForDay(events: CalendarEvent[], day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

  return events.filter((event) => new Date(event.startAt) < end && new Date(event.endAt) > start);
}

function isToday(date: Date) {
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
