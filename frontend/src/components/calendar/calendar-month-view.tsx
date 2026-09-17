import type { CalendarEvent } from "@/types/calendar";
import { formatCompactLunarDate, formatLunarDate, getCalendarDateTextClass, getCalendarDayMetadata, getCalendarWeekdayTextClass } from "@/lib/calendar-date-style";
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
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 max-[479px]:p-2">
            <div className="grid grid-cols-7 border-b border-[var(--border)] pb-3 text-center text-sm font-bold text-[var(--muted)] max-[479px]:pb-2 max-[479px]:text-xs">
                {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
                    <div key={day} className={getCalendarWeekdayTextClass(index)}>{day}</div>
                ))}
            </div>

            <div className="grid grid-cols-7">
                {days.map((day) => {
                    const dayEvents = getEventsForDay(events, day.date);
                    const metadata = getCalendarDayMetadata(dayMetadataByDate, day.date);
                    const visibleEvents = dayEvents.slice(0, 3);
                    const hiddenEventCount = dayEvents.length - visibleEvents.length;
                    return (
                        <article
                            key={day.date.toISOString()}
                            className={[
                                "relative min-h-28 border-b border-r border-[var(--border)] p-2 transition hover:bg-[var(--primary-soft)] max-[479px]:min-h-[5.75rem] max-[479px]:p-1",
                                day.date.getDay() === 0 ? "border-l" : "",
                                day.isCurrentMonth ? "" : "opacity-35",
                                selectedDate === formatDate(day.date) ? "bg-[var(--primary-soft)]" : "",
                            ].join(" ")}
                        >
                            <Link
                                href={`/calendar?year=${day.date.getFullYear()}&month=${day.date.getMonth() + 1}&date=${formatDate(day.date)}&mode=create`}
                                aria-label={`${formatDate(day.date)} 새 일정 만들기`}
                                className="absolute inset-0 z-0"
                            />

                            <div className="pointer-events-none relative z-10 flex items-center justify-between max-[479px]:flex-col max-[479px]:items-center max-[479px]:gap-0.5">
                                <span
                                  className={[
                                      "grid h-7 w-7 place-items-center rounded-full text-sm font-bold max-[479px]:h-5 max-[479px]:w-5 max-[479px]:text-xs",
                                      day.isToday ? "bg-[var(--primary-soft)]" : "",
                                      getCalendarDateTextClass(day.date, metadata),
                                  ].join(" ")}
                                >
                                    {day.date.getDate()}
                                </span>
                                <span className="text-[10px] font-medium text-[var(--muted)] max-[479px]:text-[9px]">
                                    <span className="max-[479px]:hidden">{formatLunarDate(metadata)}</span>
                                    <span className="hidden max-[479px]:inline">{formatCompactLunarDate(metadata)}</span>
                                </span>
                            </div>

                            {metadata?.holidayName && (
                                <p className="pointer-events-none relative z-10 mt-1 truncate text-[10px] font-semibold text-[#d9363e]">
                                    {metadata.holidayName}
                                </p>
                            )}

                            <div className="relative z-10 mt-2 flex flex-col gap-1 max-[479px]:mt-1 max-[479px]:gap-0.5">
                                {visibleEvents.map((event) => {
                                    const segment = getMonthEventSegment(event, day.date);

                                    return (
                                    <Link
                                        key={event.occurrenceKey}
                                        href={`/calendar?year=${year}&month=${month}&date=${formatDate(day.date)}&occurrenceKey=${encodeURIComponent(event.occurrenceKey)}&mode=${event.readOnly ? "detail" : "edit"}`}
                                        className={[
                                            "flex min-w-0 flex-col items-start overflow-y-hidden text-xs font-semibold transition",
                                            event.allDay
                                                ? `px-2 py-1 max-[479px]:px-[5px] max-[479px]:py-0 max-[479px]:text-[10px] ${allDaySegmentClass(segment)}`
                                                : "border bg-[var(--surface)] px-2 py-1 text-[var(--foreground)] max-[479px]:min-h-4 max-[479px]:justify-center max-[479px]:px-1 max-[479px]:py-0 max-[479px]:text-[10px]",
                                        ].join(" ")}
                                        style={event.allDay
                                            ? { backgroundColor: event.color }
                                            : { borderColor: event.color }}
                                        title={event.readOnly ? `${event.title} (Google Calendar)` : event.recurrenceRule === "NONE" ? event.title : `${event.title} (반복 일정)`}
                                    >
                                        {!event.allDay && (
                                            <span className="text-[10px] font-medium leading-4 text-[var(--muted)] max-[479px]:hidden">
                                                {formatTimeRange(event)}
                                            </span>
                                        )}
                                        {(segment === "single" || segment === "start") && (
                                            <CalendarEventTitle title={event.title} />
                                        )}
                                    </Link>
                                    );
                                })}
                                {hiddenEventCount > 0 && (
                                    <Link
                                        href={`/calendar?view=day&date=${formatDate(day.date)}`}
                                        className="inline-flex h-5 w-fit items-center rounded px-1 text-[10px] font-bold text-[var(--primary)] transition hover:bg-[var(--primary-soft)] max-[479px]:h-4 max-[479px]:text-[9px]"
                                        aria-label={`${formatDate(day.date)}의 나머지 일정 ${hiddenEventCount}건 보기`}
                                    >
                                        +{hiddenEventCount}
                                    </Link>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

type MonthEventSegment = "single" | "start" | "middle" | "end";

function CalendarEventTitle({ title }: { title: string }) {
    return (
        <span className="w-full overflow-x-hidden overflow-y-hidden text-ellipsis whitespace-nowrap max-[479px]:max-h-6 max-[479px]:whitespace-normal max-[479px]:text-clip max-[479px]:leading-3 max-[479px]:[line-break:strict] max-[479px]:[word-break:keep-all] max-[479px]:[overflow-wrap:anywhere]">
            {title.split(/(\[[^\[\]]*\]|\([^()]*\))/g).map((part, index) => (
                <span
                    key={`${part}-${index}`}
                    className={isBracketedTitlePart(part) ? "whitespace-nowrap" : undefined}
                >
                    {part}
                </span>
            ))}
        </span>
    );
}

function isBracketedTitlePart(value: string) {
    return /^(\[[^\[\]]*\]|\([^()]*\))$/.test(value);
}

function getMonthEventSegment(event: CalendarEvent, date: Date): MonthEventSegment {
    if (!event.allDay) {
        return "single";
    }

    const startDate = startOfDay(new Date(event.startAt));
    const inclusiveEndDate = startOfDay(new Date(event.endAt));
    inclusiveEndDate.setDate(inclusiveEndDate.getDate() - 1);
    const currentDate = startOfDay(date);

    if (isSameDate(startDate, inclusiveEndDate)) return "single";
    if (isSameDate(currentDate, startDate)) return "start";
    if (isSameDate(currentDate, inclusiveEndDate)) return "end";
    return "middle";
}

function allDaySegmentClass(segment: MonthEventSegment) {
    const sharedClass = "h-6 justify-center overflow-x-hidden overflow-y-hidden";

    if (segment === "start") return `${sharedClass} -mx-2 rounded-l-[3px] rounded-r-none text-[#062b20] max-[479px]:-mx-1`;
    if (segment === "middle") return `${sharedClass} -mx-2 rounded-none text-transparent max-[479px]:-mx-1`;
    if (segment === "end") return `${sharedClass} -mx-2 rounded-l-none rounded-r-[3px] text-transparent max-[479px]:-mx-1`;
    return "h-6 justify-center overflow-x-hidden overflow-y-hidden rounded-[3px] text-[#062b20] max-[479px]:h-auto max-[479px]:min-h-4";
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
