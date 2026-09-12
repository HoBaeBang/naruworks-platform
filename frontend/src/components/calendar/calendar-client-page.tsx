"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarEventCreateModal } from "@/components/calendar/calendar-event-create-modal";
import { CalendarEventEditModal } from "@/components/calendar/calendar-event-edit-modal";
import { CalendarExternalEventDetailModal } from "@/components/calendar/calendar-external-event-detail-modal";
import { CalendarSidebar } from "@/components/calendar/calendar-sidebar";
import { CalendarInvitationJoinModal } from "@/components/calendar/calendar-invitation-join-modal";
import { CalendarDayView } from "@/components/calendar/calendar-day-view";
import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { CalendarWeekView } from "@/components/calendar/calendar-week-view";
import { CalendarYearView } from "@/components/calendar/calendar-year-view";
import { CalendarApiError, getCalendarEvents } from "@/lib/calendar-api";
import type { CalendarMembership } from "@/lib/calendars-api";
import { getCalendarDayMetadata } from "@/lib/calendar-day-metadata-api";
import { getLoginUrl } from "@/lib/auth-url";
import type { CalendarEvent } from "@/types/calendar";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";

type CalendarView = "year" | "month" | "week" | "day";

export function CalendarClientPage() {
  const searchParams = useSearchParams();
  const today = useMemo(() => startOfDay(new Date()), []);
  const view = parseView(searchParams.get("view"));
  const year = getPositiveNumber(searchParams.get("year"), today.getFullYear());
  const month = getPositiveNumber(searchParams.get("month"), today.getMonth() + 1);
  const navigationDate = getDate(
    searchParams.get("date"),
    view === "month" || view === "year" ? new Date(year, month - 1, 1) : today,
  );
  const mode = searchParams.get("mode");
  const selectedDate = mode ? searchParams.get("date") ?? undefined : undefined;
  const selectedOccurrenceKey = searchParams.get("occurrenceKey");
  const invitationToken = searchParams.get("invite");
  const range = getViewRange(view, year, month, navigationDate);
  const rangeFrom = toDateTime(range.from);
  const rangeTo = toDateTime(range.to);
  const metadataRange = getMetadataRange(view, year, month, range);
  const metadataFrom = formatDate(metadataRange.from);
  const metadataTo = formatDate(metadataRange.to);
  const calendarHref = getCalendarHref(view, year, month, navigationDate);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [dayMetadata, setDayMetadata] = useState<CalendarDayMetadata[]>([]);
  const [error, setError] = useState<CalendarApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedEventsRef = useRef(false);
  const [hasLoadedEvents, setHasLoadedEvents] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeCalendar, setActiveCalendar] = useState<CalendarMembership | null>(null);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<number>>(new Set());
  const [calendars, setCalendars] = useState<CalendarMembership[]>([]);

  useEffect(() => {
    let isActive = true;

    async function loadEvents() {
      const isInitialLoad = !hasLoadedEventsRef.current;
      if (isInitialLoad) setIsLoading(true);
      setError(null);

      try {
        const [eventResult, metadataResult] = await Promise.all([
          getCalendarEvents(rangeFrom, rangeTo),
          getCalendarDayMetadata(metadataFrom, metadataTo),
        ]);
        if (isActive) {
          setEvents(eventResult);
          setDayMetadata(metadataResult);
          hasLoadedEventsRef.current = true;
          setHasLoadedEvents(true);
        }
      } catch (cause) {
        if (isActive) {
          setError(cause instanceof CalendarApiError ? cause : new CalendarApiError("일정을 불러오지 못했습니다.", 0));
        }
      } finally {
        if (isActive) {
          if (isInitialLoad) setIsLoading(false);
        }
      }
    }

    void loadEvents();
    return () => {
      isActive = false;
    };
  }, [metadataFrom, metadataTo, rangeFrom, rangeTo, reloadToken]);

  const dayMetadataByDate = useMemo(
    () => new Map(dayMetadata.map((metadata) => [metadata.date, metadata])),
    [dayMetadata],
  );

  const selectedEvent = selectedOccurrenceKey
    ? events.find((event) => event.occurrenceKey === selectedOccurrenceKey)
    : undefined;
  const visibleEvents = events.filter(
    (event) => event.source === "GOOGLE"
      || (event.calendarId !== null && visibleCalendarIds.has(event.calendarId)),
  );
  const canRenderCalendar = !isLoading && (!error || hasLoadedEvents);

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)] sm:px-8 lg:px-10">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-sm font-bold text-[var(--primary-strong)]">← Naru 홈으로</Link>
            <p className="mt-8 text-sm font-bold text-[var(--primary-strong)]">첫 번째 서비스</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Naru Calendar</h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--muted)]">나만의 일정과 약속을 한곳에서 관리합니다.</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <CalendarViewTabs view={view} year={year} month={month} navigationDate={navigationDate} today={today} />
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--muted)]">
              {rangeLabel(view, range.from, range.to)}
            </div>
            <div className="flex items-center gap-2">
              <CalendarNavLink label="←" ariaLabel="이전 기간" href={getNavigationHref(view, year, month, navigationDate, -1)} />
              <CalendarNavLink label="오늘" ariaLabel="오늘" href={getTodayHref(view, today)} />
              <CalendarNavLink label="→" ariaLabel="다음 기간" href={getNavigationHref(view, year, month, navigationDate, 1)} />
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="self-start lg:sticky lg:top-6">
            <CalendarSidebar
              justConnected={searchParams.get("google-calendar") === "connected"}
              activeCalendar={activeCalendar}
              visibleCalendarIds={visibleCalendarIds}
              onActiveCalendarChange={setActiveCalendar}
              onVisibleCalendarIdsChange={setVisibleCalendarIds}
              onCalendarsChanged={setCalendars}
            />
          </aside>
          <div>
            {isLoading && <CalendarMessage message="일정을 불러오는 중입니다." />}
            {error && <CalendarError error={error} onRetry={() => setReloadToken((token) => token + 1)} />}
            {canRenderCalendar && view === "month" && <CalendarMonthView year={year} month={month} events={visibleEvents} dayMetadataByDate={dayMetadataByDate} selectedDate={selectedDate} />}
            {canRenderCalendar && view === "week" && <CalendarWeekView anchorDate={navigationDate} events={visibleEvents} dayMetadataByDate={dayMetadataByDate} />}
            {canRenderCalendar && view === "day" && <CalendarDayView date={navigationDate} events={visibleEvents} dayMetadataByDate={dayMetadataByDate} />}
            {canRenderCalendar && view === "year" && <CalendarYearView year={year} events={visibleEvents} dayMetadataByDate={dayMetadataByDate} />}
          </div>
        </div>

        {selectedDate && mode === "create" && !error && <CalendarEventCreateModal selectedDate={selectedDate} calendars={calendars} initialCalendarId={activeCalendar?.id} closeHref={calendarHref} onEventChanged={() => setReloadToken((token) => token + 1)} />}
        {selectedDate && mode === "edit" && selectedEvent && !selectedEvent.readOnly && !error && <CalendarEventEditModal event={selectedEvent} calendars={calendars} closeHref={calendarHref} onEventChanged={() => setReloadToken((token) => token + 1)} />}
        {selectedDate && mode === "detail" && selectedEvent?.readOnly && !error && <CalendarExternalEventDetailModal event={selectedEvent} closeHref={calendarHref} />}
        {invitationToken && <CalendarInvitationJoinModal token={invitationToken} closeHref={calendarHref} />}
      </section>
    </main>
  );
}

function CalendarViewTabs({ view, year, month, navigationDate, today }: { view: CalendarView; year: number; month: number; navigationDate: Date; today: Date }) {
  return <div className="flex h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
    {(["year", "month", "week", "day"] as const).map((item) => <Link key={item} href={getCalendarHref(item, item === "month" ? year : today.getFullYear(), item === "month" ? month : today.getMonth() + 1, item === "month" ? navigationDate : today)} className={["inline-flex h-9 items-center rounded-md px-3 text-sm font-bold transition", view === item ? "bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"].join(" ")}>{viewLabel(item)}</Link>)}
  </div>;
}

function CalendarError({ error, onRetry }: { error: CalendarApiError; onRetry: () => void }) {
  const loginRequired = error.status === 401 || error.status === 403;
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center"><h2 className="text-xl font-semibold">{loginRequired ? "로그인이 필요합니다" : "일정을 불러오지 못했습니다"}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{loginRequired ? "Google 로그인 후 내 일정을 확인할 수 있습니다." : "잠시 후 다시 시도해주세요."}</p><div className="mt-6 flex justify-center gap-3">{loginRequired ? <a href={getLoginUrl()} className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20]">Google 로그인</a> : <button type="button" onClick={onRetry} className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20]">다시 시도</button>}</div></section>;
}

function CalendarMessage({ message }: { message: string }) { return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-sm font-bold text-[var(--muted)]">{message}</section>; }
function CalendarNavLink({ label, ariaLabel, href }: { label: string; ariaLabel: string; href: string }) { const isIconOnly = label !== "오늘"; return <Link href={href} aria-label={ariaLabel} className={["inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]", isIconOnly ? "w-11 px-0" : "px-4"].join(" ")}>{label}</Link>; }

function getViewRange(view: CalendarView, year: number, month: number, date: Date) { if (view === "year") { return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) }; } if (view === "month") { const from = new Date(year, month - 1, 1); return { from, to: new Date(year, month, 1) }; } if (view === "week") { const from = new Date(date); from.setDate(date.getDate() - date.getDay()); const to = new Date(from); to.setDate(from.getDate() + 7); return { from, to }; } const from = startOfDay(date); const to = new Date(from); to.setDate(from.getDate() + 1); return { from, to }; }
function getMetadataRange(view: CalendarView, year: number, month: number, range: { from: Date; to: Date }) { if (view !== "month") return { from: range.from, to: addDays(range.to, -1) }; const firstDay = new Date(year, month - 1, 1); const from = new Date(firstDay); from.setDate(firstDay.getDate() - firstDay.getDay()); return { from, to: addDays(from, 41) }; }
function getNavigationHref(view: CalendarView, year: number, month: number, date: Date, offset: -1 | 1) { const target = new Date(date); if (view === "year") { return getCalendarHref(view, year + offset, month, target); } if (view === "month") { target.setMonth(target.getMonth() + offset); return getCalendarHref(view, target.getFullYear(), target.getMonth() + 1, target); } target.setDate(target.getDate() + (view === "week" ? offset * 7 : offset)); return getCalendarHref(view, target.getFullYear(), target.getMonth() + 1, target); }
function getTodayHref(view: CalendarView, today: Date) { return getCalendarHref(view, today.getFullYear(), today.getMonth() + 1, today); }
function getCalendarHref(view: CalendarView, year: number, month: number, date: Date) { if (view === "year") return `/calendar?view=year&year=${year}`; return view === "month" ? `/calendar?view=month&year=${year}&month=${month}` : `/calendar?view=${view}&date=${formatDate(date)}`; }
function parseView(value: string | null): CalendarView { return value === "year" || value === "week" || value === "day" ? value : "month"; }
function getPositiveNumber(value: string | null, fallback: number) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function getDate(value: string | null, fallback: Date) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : fallback; }
function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0); }
function toDateTime(date: Date) { return `${formatDate(date)}T00:00:00`; }
function addDays(date: Date, amount: number) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
function formatDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function viewLabel(view: CalendarView) { return view === "year" ? "연간" : view === "month" ? "월간" : view === "week" ? "주간" : "일간"; }
function rangeLabel(view: CalendarView, from: Date, to: Date) { if (view === "year") return `${from.getFullYear()}년`; if (view === "month") return `${from.getFullYear()}년 ${from.getMonth() + 1}월`; if (view === "day") return `${from.getMonth() + 1}월 ${from.getDate()}일`; const lastDay = new Date(to); lastDay.setDate(to.getDate() - 1); return `${from.getMonth() + 1}월 ${from.getDate()}일 - ${lastDay.getMonth() + 1}월 ${lastDay.getDate()}일`; }
