import type { CalendarEvent } from "@/types/calendar";
import { formatLunarDate, getCalendarDateTextClass, getCalendarDayMetadata, getCalendarWeekdayTextClass } from "@/lib/calendar-date-style";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";
import Link from "next/link";

type CalendarDay = {
    date: Date;
    isCurrentMonth: boolean;
    isToday: boolean;
};

export function CalendarMonthView({
                                      year,
                                      month,
                                      events,
                                      dayMetadataByDate,
                                      selectedDate,
                                  }: {
    year: number;
    month: number;
    events: CalendarEvent[];
    dayMetadataByDate: ReadonlyMap<string, CalendarDayMetadata>;
    selectedDate?: string;
}) {
    const days = createMonthDays(year, month);

    return (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="grid grid-cols-7 border-b border-[var(--border)] pb-3 text-center text-sm font-bold text-[var(--muted)]">
                {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
                    <div key={day} className={getCalendarWeekdayTextClass(index)}>{day}</div>
                ))}
            </div>

            <div className="grid grid-cols-7">
                {days.map((day) => {
                    const dayEvents = getEventsForDay(events, day.date);
                    const metadata = getCalendarDayMetadata(dayMetadataByDate, day.date);
                    return (
                        <article
                            key={day.date.toISOString()}
                            className={[
                                "relative min-h-28 border-b border-r border-[var(--border)] p-2 transition hover:bg-[var(--primary-soft)]",
                                day.isCurrentMonth ? "" : "opacity-35",
                                selectedDate === formatDate(day.date) ? "bg-[var(--primary-soft)]" : "",
                            ].join(" ")}
                        >
                            <Link
                                href={`/calendar?year=${day.date.getFullYear()}&month=${day.date.getMonth() + 1}&date=${formatDate(day.date)}&mode=create`}
                                aria-label={`${formatDate(day.date)} 새 일정 만들기`}
                                className="absolute inset-0 z-0"
                            />

                            <div className="pointer-events-none relative z-10 flex items-center justify-between">
                                <span
                                  className={[
                                      "grid h-7 w-7 place-items-center rounded-full text-sm font-bold",
                                      day.isToday ? "bg-[var(--primary-soft)]" : "",
                                      getCalendarDateTextClass(day.date, metadata),
                                  ].join(" ")}
                                >
                                    {day.date.getDate()}
                                </span>
                                <span className="text-[10px] font-medium text-[var(--muted)]">
                                    {formatLunarDate(metadata)}
                                </span>
                            </div>

                            {metadata?.holidayName && (
                                <p className="pointer-events-none relative z-10 mt-1 truncate text-[10px] font-semibold text-[#d9363e]">
                                    {metadata.holidayName}
                                </p>
                            )}

                            <div className="relative z-10 mt-2 flex flex-col gap-1">
                                {dayEvents.slice(0, 3).map((event) => (
                                    <Link
                                        key={event.occurrenceKey}
                                        href={`/calendar?year=${year}&month=${month}&date=${formatDate(day.date)}&occurrenceKey=${encodeURIComponent(event.occurrenceKey)}&mode=${event.readOnly ? "detail" : "edit"}`}
                                        className={[
                                            "flex min-w-0 flex-col items-start rounded-md px-2 py-1 text-xs font-semibold transition",
                                            event.allDay
                                                ? "text-[#062b20]"
                                                : "border bg-[var(--surface)] text-[var(--foreground)]",
                                        ].join(" ")}
                                        style={event.allDay
                                            ? { backgroundColor: event.color }
                                            : { borderColor: event.color }}
                                        title={event.readOnly ? `${event.title} (Google Calendar)` : event.recurrenceRule === "NONE" ? event.title : `${event.title} (반복 일정)`}
                                    >
                                        {!event.allDay && (
                                            <span className="text-[10px] font-medium leading-4 text-[var(--muted)]">
                                                {formatTimeRange(event)}
                                            </span>
                                        )}
                                        <span className="w-full truncate">{event.title}</span>
                                    </Link>
                                ))}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

function createMonthDays(year: number, month: number): CalendarDay[] {
    const firstDay = new Date(year, month - 1, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(firstDay.getDate() - firstDay.getDay());

    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + index);

        return {
            date,
            isCurrentMonth: date.getMonth() === month - 1,
            isToday: isSameDate(date, new Date()),
        };
    });
}

function getEventsForDay(events: CalendarEvent[], date: Date) {
    return events
        .filter((event) => {
            const startAt = new Date(event.startAt);
            const endAt = new Date(event.endAt);

            return startAt <= endOfDay(date) && endAt > startOfDay(date);
        })
        .sort((left, right) => {
            if (left.allDay !== right.allDay) {
                return left.allDay ? -1 : 1;
            }

            return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
        });
}

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
}

function endOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
}

function isSameDate(left: Date, right: Date) {
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
}

function formatDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function formatTimeRange(event: CalendarEvent) {
    return `${event.startAt.slice(11, 16)} - ${event.endAt.slice(11, 16)}`;
}
