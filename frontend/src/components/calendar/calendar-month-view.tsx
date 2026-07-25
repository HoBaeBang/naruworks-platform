import type { CalendarEvent } from "@/types/calendar";
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
                                      selectedDate,
                                  }: {
    year: number;
    month: number;
    events: CalendarEvent[];
    selectedDate?: string;
}) {
    const days = createMonthDays(year, month);

    return (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="grid grid-cols-7 border-b border-[var(--border)] pb-3 text-center text-sm font-bold text-[var(--muted)]">
                {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                    <div key={day}>{day}</div>
                ))}
            </div>

            <div className="grid grid-cols-7">
                {days.map((day) => {
                    const dayEvents = getEventsForDay(events, day.date);
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
                                      day.isToday
                                          ? "bg-[var(--primary)] text-[#062b20]"
                                          : "text-[var(--foreground)]",
                                  ].join(" ")}
                                >
                                    {day.date.getDate()}
                                </span>
                            </div>

                            <div className="relative z-10 mt-2 flex flex-col gap-1">
                                {dayEvents.slice(0, 3).map((event) => (
                                    <Link
                                        key={event.id}
                                        href={`/calendar?year=${year}&month=${month}&date=${formatDate(day.date)}&eventId=${event.id}&mode=edit`}
                                        className="truncate rounded-md px-2 py-1 text-xs font-semibold text-[#062b20]"
                                        style={{ backgroundColor: event.color }}
                                        title={event.title}
                                    >
                                        {event.title}
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
    return events.filter((event) => {
        const startAt = new Date(event.startAt);
        const endAt = new Date(event.endAt);

        return startAt <= endOfDay(date) && endAt >= startOfDay(date);
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
