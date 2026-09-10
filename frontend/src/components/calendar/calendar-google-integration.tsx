"use client";

import { useEffect, useState } from "react";
import {
  getGoogleCalendarAuthorizationUrl,
  getGoogleCalendarIntegration,
  getGoogleCalendarSelections,
  updateGoogleCalendarSelections,
  type GoogleCalendarIntegration,
  type GoogleCalendarSelection,
} from "@/lib/google-calendar-integration-api";

type CalendarGoogleIntegrationProps = {
  justConnected: boolean;
};

export function CalendarGoogleIntegration({
  justConnected,
}: CalendarGoogleIntegrationProps) {
  const [integration, setIntegration] = useState<GoogleCalendarIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarSelection[]>([]);
  const [isCalendarLoading, setIsCalendarLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [calendarError, setCalendarError] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadIntegration() {
      try {
        const result = await getGoogleCalendarIntegration();
        if (isActive) {
          setIntegration(result);
        }
      } catch {
        if (isActive) {
          setHasError(true);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadIntegration();
    return () => {
      isActive = false;
    };
  }, []);

  const isConnected = integration?.connected === true;

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    let isActive = true;
    void getGoogleCalendarSelections()
      .then((result) => {
        if (isActive) {
          setCalendars(result);
          setCalendarError(false);
        }
      })
      .catch(() => {
        if (isActive) {
          setCalendarError(true);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsCalendarLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isConnected]);

  function toggleCalendar(calendarId: string) {
    setCalendars((current) => current.map((calendar) => (
      calendar.calendarId === calendarId
        ? { ...calendar, enabled: !calendar.enabled }
        : calendar
    )));
  }

  async function saveSelections() {
    setIsSaving(true);
    setCalendarError(false);
    try {
      const result = await updateGoogleCalendarSelections(
        calendars.filter((calendar) => calendar.enabled).map((calendar) => calendar.calendarId),
      );
      setCalendars(result);
    } catch {
      setCalendarError(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex min-h-11 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[var(--foreground)]">Google Calendar</p>
          {isLoading && <p className="mt-0.5 text-xs text-[var(--muted)]">연결 상태 확인 중</p>}
          {!isLoading && isConnected && (
            <p className="mt-0.5 truncate text-xs text-[var(--primary-strong)]">
              {integration.email ?? "연결됨"}
            </p>
          )}
          {!isLoading && !isConnected && !hasError && (
            <p className="mt-0.5 text-xs text-[var(--muted)]">연결되지 않음</p>
          )}
          {!isLoading && hasError && (
            <p className="mt-0.5 text-xs text-[var(--muted)]">연결 상태를 확인할 수 없음</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => window.location.assign(getGoogleCalendarAuthorizationUrl())}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] px-3 text-xs font-bold text-[var(--primary-strong)] transition hover:bg-[var(--mint-highlight)]"
        >
          {isConnected ? "다시 연결" : "연결"}
        </button>
      </div>

      {!isLoading && isConnected && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          {isCalendarLoading && <p className="text-xs text-[var(--muted)]">캘린더 목록을 불러오는 중</p>}
          {!isCalendarLoading && calendarError && (
            <p className="text-xs text-[var(--muted)]">캘린더 목록 또는 선택을 확인하지 못했습니다.</p>
          )}
          {!isCalendarLoading && !calendarError && calendars.length === 0 && (
            <p className="text-xs text-[var(--muted)]">표시할 Google Calendar가 없습니다.</p>
          )}
          {!isCalendarLoading && !calendarError && calendars.length > 0 && (
            <div className="space-y-1.5">
              {calendars.map((calendar) => (
                <label key={calendar.calendarId} className="flex cursor-pointer items-center gap-2 text-xs text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={calendar.enabled}
                    onChange={() => toggleCalendar(calendar.calendarId)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: calendar.color ?? "var(--primary)" }}
                  />
                  <span className="truncate">{calendar.name}</span>
                  {calendar.primary && <span className="text-[var(--muted)]">기본</span>}
                </label>
              ))}
              <button
                type="button"
                onClick={() => void saveSelections()}
                disabled={isSaving}
                className="mt-1 inline-flex h-8 items-center justify-center rounded-md border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--primary-strong)] transition hover:bg-[var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "저장 중" : "선택 저장"}
              </button>
            </div>
          )}
        </div>
      )}

      {justConnected && isConnected && (
        <span className="sr-only" aria-live="polite">Google Calendar 연결이 완료되었습니다.</span>
      )}
    </section>
  );
}
