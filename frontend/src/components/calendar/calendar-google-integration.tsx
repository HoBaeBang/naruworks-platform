"use client";

import { useEffect, useState } from "react";
import {
  getGoogleCalendarAuthorizationUrl,
  getGoogleCalendarIntegration,
  type GoogleCalendarIntegration,
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

  return (
    <section className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="min-w-0">
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

      {justConnected && isConnected && (
        <span className="sr-only" aria-live="polite">Google Calendar 연결이 완료되었습니다.</span>
      )}
    </section>
  );
}
