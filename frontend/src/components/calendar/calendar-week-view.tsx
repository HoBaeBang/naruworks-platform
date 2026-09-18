import { CalendarTimeGrid } from "@/components/calendar/calendar-time-grid";
import { formatLunarDate, getCalendarDateTextClass, getCalendarDayMetadata, getCalendarWeekdayTextClass } from "@/lib/calendar-date-style";
import type { CalendarEvent } from "@/types/calendar";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";
import Link from "next/link";

export function CalendarWeekView({
  anchorDate,
  events,
  dayMetadataByDate,
  mobileLayout,
}: {
  anchorDate: Date;
  events: CalendarEvent[];
  dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata>;
  mobileLayout: "agenda" | "grid";
}) {
  const weekStart = new Date(anchorDate);
  weekStart.setDate(anchorDate.getDate() - anchorDate.getDay());
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });

  return (
    <>
      <div className="max-[479px]:hidden">
        <CalendarTimeGrid days={days} events={events} view="week" dayMetadataByDate={dayMetadataByDate} />
      </div>
      <div className="hidden max-[479px]:block">
        <MobileLayoutTabs anchorDate={anchorDate} mobileLayout={mobileLayout} />
        {mobileLayout === "agenda" ? (
          <MobileWeekAgenda days={days} events={events} dayMetadataByDate={dayMetadataByDate} />
        ) : (
          <CalendarTimeGrid days={days} events={events} view="week" dayMetadataByDate={dayMetadataByDate} />
        )}
      </div>
    </>
  );
}

function MobileLayoutTabs({ anchorDate, mobileLayout }: { anchorDate: Date; mobileLayout: "agenda" | "grid" }) {
  return (
    <nav aria-label="모바일 주간 보기 방식" className="mb-3 flex justify-end px-3">
      <div className="flex h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs font-bold">
        <LayoutTab label="목록" href={getWeekHref(anchorDate, "agenda")} active={mobileLayout === "agenda"} />
        <LayoutTab label="시간표" href={getWeekHref(anchorDate, "grid")} active={mobileLayout === "grid"} />
      </div>
    </nav>
  );
}

function LayoutTab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-7 items-center rounded-md px-3 transition ${active ? "bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
    >
      {label}
    </Link>
  );
}

function MobileWeekAgenda({
  days,
  events,
  dayMetadataByDate,
}: {
  days: Date[];
  events: CalendarEvent[];
  dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {days.map((day) => {
        const metadata = getCalendarDayMetadata(dayMetadataByDate, day);
        const dayEvents = eventsForDay(events, day);

        return (
          <article key={day.toISOString()} className="border-b border-[var(--border)] p-3 last:border-b-0">
            <header className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${getCalendarWeekdayTextClass(day.getDay())}`}>{weekdayLabel(day)}</p>
                  <div className="flex items-baseline gap-1.5">
                    <p className={`text-lg font-semibold ${getCalendarDateTextClass(day, metadata)}`}>{day.getDate()}</p>
                    <p className="text-[10px] font-medium text-[var(--muted)]">{formatLunarDate(metadata)}</p>
                  </div>
                </div>
                {metadata?.holidayName && <p className="truncate text-xs font-semibold text-[#d9363e]">{metadata.holidayName}</p>}
              </div>
              <Link
                href={`/calendar?view=week&date=${formatDate(day)}&mode=create`}
                aria-label={`${formatDate(day)} 새 일정 만들기`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--border)] text-lg text-[var(--muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
              >
                +
              </Link>
            </header>

            {dayEvents.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1.5">
                {dayEvents.map((event) => (
                  <Link
                    key={event.occurrenceKey}
                    href={`/calendar?view=week&date=${formatDate(day)}&occurrenceKey=${encodeURIComponent(event.occurrenceKey)}&mode=${event.readOnly ? "detail" : "edit"}`}
                    className={[
                      "flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-xs font-semibold",
                      event.allDay
                        ? "text-[#062b20]"
                        : "border bg-[var(--surface-raised)] text-[var(--foreground)]",
                    ].join(" ")}
                    style={event.allDay ? { backgroundColor: event.color } : { borderColor: event.color }}
                    title={event.title}
                  >
                    <span className="w-[4.5rem] shrink-0 pt-0.5 text-[10px] font-medium text-[var(--muted)]">
                      {event.allDay ? "종일" : formatTimeRange(event)}
                    </span>
                    <span className="max-h-10 min-w-0 overflow-hidden leading-5">{event.title}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted)]">일정 없음</p>
            )}
          </article>
        );
      })}
    </section>
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

function getWeekHref(date: Date, mobileLayout: "agenda" | "grid") {
  const base = `/calendar?view=week&date=${formatDate(date)}`;
  return mobileLayout === "grid" ? `${base}&weekLayout=grid` : base;
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
