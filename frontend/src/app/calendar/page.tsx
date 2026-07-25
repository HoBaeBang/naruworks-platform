import Link from "next/link";
import { CalendarEventCreateModal } from "@/components/calendar/calendar-event-create-modal";
import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { getCalendarEvents } from "@/lib/calendar-api";
import { CalendarEventEditModal } from "@/components/calendar/calendar-event-edit-modal";

export default async function CalendarPage({
                                               searchParams,
                                           }: {
    searchParams: Promise<{
      year?: string;
      month?: string;
      date?: string;
      mode?: string;
      eventId?: string;
}>;
}) {
    const params = await searchParams;
    const selectedEventId = params.eventId ? Number(params.eventId) : null;
    const selectedDate = params.date;
    const mode = params.mode;
    const today = new Date();

    const year = Number(params.year ?? today.getFullYear());
    const month = Number(params.month ?? today.getMonth() + 1);

    const from = `${year}-${pad(month)}-01T00:00:00`;
    const to = getNextMonthStart(year, month);

    const events = await getCalendarEvents(from, to);
    const selectedEvent = selectedEventId
      ? events.find((event) => event.id === selectedEventId)
      : null;

    const previousMonth = getAdjacentMonth(year, month, -1);
    const nextMonth = getAdjacentMonth(year, month, 1);
    const todayMonth = {
        year: today.getFullYear(),
        month: today.getMonth() + 1,
    };

    return (
        <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)] sm:px-8 lg:px-10">
            <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
                <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <Link
                            href="/"
                            className="text-sm font-bold text-[var(--primary-strong)]"
                        >
                            ← Naru 홈으로
                        </Link>
                        <p className="mt-8 text-sm font-bold text-[var(--primary-strong)]">
                            첫 번째 서비스
                        </p>
                        <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
                            Naru Calendar
                        </h1>
                        <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--muted)]">
                            일정관리 서비스의 첫 화면입니다. 지금은 월간 조회를 먼저
                            연결하고, 이후 생성/수정 모달과 반복 일정으로 확장합니다.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--muted)]">
                            {year}년 {month}월
                        </div>

                        <div className="flex items-center gap-2">
                            <CalendarNavLink label="←" ariaLabel="이전 달" year={previousMonth.year} month={previousMonth.month} />
                            <CalendarNavLink label="오늘" ariaLabel="오늘이 포함된 달" year={todayMonth.year} month={todayMonth.month} />
                            <CalendarNavLink label="→" ariaLabel="다음 달" year={nextMonth.year} month={nextMonth.month} />
                        </div>
                    </div>
                </header>

                <CalendarMonthView
                    year={year}
                    month={month}
                    events={events}
                    selectedDate={selectedDate}
                />
                {selectedDate && (
                    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-bold text-[var(--primary-strong)]">
                                    선택한 날짜
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold">{selectedDate}</h2>
                                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                                    이 날짜에 새 일정을 추가하거나 기존 일정을 확인하는 영역으로 확장합니다.
                                </p>
                            </div>

                            <Link
                                href={`/calendar?year=${year}&month=${month}&date=${selectedDate}&mode=create`}
                                className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.20)]"
                            >
                                새 일정
                            </Link>
                        </div>
                    </section>
                )}
                {selectedDate && mode === "create" && (
                    <CalendarEventCreateModal
                        selectedDate={selectedDate}
                        year={year}
                        month={month}
                    />
                )}

                {selectedDate && mode === "edit" && selectedEvent && (
                    <CalendarEventEditModal
                        event={selectedEvent}
                        selectedDate={selectedDate}
                        year={year}
                        month={month}
                    />
                )}
            </section>
        </main>
    );
}

function pad(value: number) {
    return String(value).padStart(2, "0");
}

function getNextMonthStart(year: number, month: number) {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextMonthYear = month === 12 ? year + 1 : year;

    return `${nextMonthYear}-${pad(nextMonth)}-01T00:00:00`;
}

function CalendarNavLink({
                             label,
                             ariaLabel,
                             year,
                             month,
                         }: {
    label: string;
    ariaLabel: string;
    year: number;
    month: number;
}) {
    const isIconOnly = label !== "오늘";

    return (
        <Link
            href={`/calendar?year=${year}&month=${month}`}
            aria-label={ariaLabel}
            className={[
                "inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]",
                isIconOnly ? "w-11 px-0" : "px-4",
            ].join(" ")}
        >
            {label}
        </Link>
    );
}

function getAdjacentMonth(year: number, month: number, offset: -1 | 1) {
    const date = new Date(year, month - 1 + offset, 1);

    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
    };
}
