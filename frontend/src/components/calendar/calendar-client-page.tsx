"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarEventCreateModal } from "@/components/calendar/calendar-event-create-modal";
import { CalendarEventEditModal } from "@/components/calendar/calendar-event-edit-modal";
import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { CalendarApiError, getCalendarEvents } from "@/lib/calendar-api";
import { getLoginUrl } from "@/lib/auth-url";
import type { CalendarEvent } from "@/types/calendar";

export function CalendarClientPage() {
  const searchParams = useSearchParams();
  const today = useMemo(() => new Date(), []);
  const year = getPositiveNumber(searchParams.get("year"), today.getFullYear());
  const month = getPositiveNumber(searchParams.get("month"), today.getMonth() + 1);
  const selectedDate = searchParams.get("date") ?? undefined;
  const mode = searchParams.get("mode");
  const selectedEventId = getOptionalPositiveNumber(searchParams.get("eventId"));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<CalendarApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const from = `${year}-${pad(month)}-01T00:00:00`;
      const result = await getCalendarEvents(from, getNextMonthStart(year, month));
      setEvents(result);
    } catch (cause) {
      if (cause instanceof CalendarApiError) {
        setError(cause);
      } else {
        setError(new CalendarApiError("일정을 불러오지 못했습니다.", 0));
      }
    } finally {
      setIsLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void Promise.resolve().then(loadEvents);
  }, [loadEvents]);

  const selectedEvent = selectedEventId
    ? events.find((event) => event.id === selectedEventId)
    : undefined;
  const previousMonth = getAdjacentMonth(year, month, -1);
  const nextMonth = getAdjacentMonth(year, month, 1);

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)] sm:px-8 lg:px-10">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-sm font-bold text-[var(--primary-strong)]">
              ← Naru 홈으로
            </Link>
            <p className="mt-8 text-sm font-bold text-[var(--primary-strong)]">첫 번째 서비스</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Naru Calendar</h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--muted)]">
              나만의 일정과 약속을 한곳에서 관리합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--muted)]">
              {year}년 {month}월
            </div>
            <div className="flex items-center gap-2">
              <CalendarNavLink label="←" ariaLabel="이전 달" {...previousMonth} />
              <CalendarNavLink label="오늘" ariaLabel="오늘이 포함된 달" year={today.getFullYear()} month={today.getMonth() + 1} />
              <CalendarNavLink label="→" ariaLabel="다음 달" {...nextMonth} />
            </div>
          </div>
        </header>

        {isLoading && <CalendarMessage message="일정을 불러오는 중입니다." />}
        {error && <CalendarError error={error} onRetry={loadEvents} />}
        {!isLoading && !error && (
          <CalendarMonthView year={year} month={month} events={events} selectedDate={selectedDate} />
        )}

        {selectedDate && mode === "create" && !error && (
          <CalendarEventCreateModal
            selectedDate={selectedDate}
            year={year}
            month={month}
            onEventChanged={loadEvents}
          />
        )}
        {selectedDate && mode === "edit" && selectedEvent && !error && (
          <CalendarEventEditModal
            event={selectedEvent}
            selectedDate={selectedDate}
            year={year}
            month={month}
            onEventChanged={loadEvents}
          />
        )}
      </section>
    </main>
  );
}

function CalendarError({ error, onRetry }: { error: CalendarApiError; onRetry: () => Promise<void> }) {
  const loginRequired = error.status === 401 || error.status === 403;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
      <h2 className="text-xl font-semibold">{loginRequired ? "로그인이 필요합니다" : "일정을 불러오지 못했습니다"}</h2>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        {loginRequired ? "Google 로그인 후 내 일정을 확인할 수 있습니다." : "잠시 후 다시 시도해주세요."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {loginRequired ? (
          <a href={getLoginUrl()} className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20]">
            Google 로그인
          </a>
        ) : (
          <button type="button" onClick={() => void onRetry()} className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20]">
            다시 시도
          </button>
        )}
      </div>
    </section>
  );
}

function CalendarMessage({ message }: { message: string }) {
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm font-bold text-[var(--muted)]">{message}</section>;
}

function CalendarNavLink({ label, ariaLabel, year, month }: { label: string; ariaLabel: string; year: number; month: number }) {
  const isIconOnly = label !== "오늘";
  return <Link href={`/calendar?year=${year}&month=${month}`} aria-label={ariaLabel} className={["inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]", isIconOnly ? "w-11 px-0" : "px-4"].join(" ")}>{label}</Link>;
}

function getPositiveNumber(value: string | null, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function getOptionalPositiveNumber(value: string | null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getNextMonthStart(year: number, month: number) {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;
  return `${nextMonthYear}-${pad(nextMonth)}-01T00:00:00`;
}

function getAdjacentMonth(year: number, month: number, offset: -1 | 1) {
  const date = new Date(year, month - 1 + offset, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}
