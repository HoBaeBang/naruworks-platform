"use client";

import { useEffect, useState } from "react";
import {
  getGoogleCalendarAuthorizationUrl,
  getGoogleCalendarIntegrations,
  getGoogleCalendarSelections,
  updateGoogleCalendarSelections,
  type GoogleCalendarIntegration,
  type GoogleCalendarSelection,
} from "@/lib/google-calendar-integration-api";

type Props = { justConnected: boolean };

export function CalendarGoogleIntegration({ justConnected }: Props) {
  const [integrations, setIntegrations] = useState<GoogleCalendarIntegration[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [calendarsByAccount, setCalendarsByAccount] = useState<Record<number, GoogleCalendarSelection[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorAccountId, setErrorAccountId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void getGoogleCalendarIntegrations()
      .then(async (result) => {
        if (!active) return;
        setIntegrations(result);
        const selections = await Promise.all(result.map(async (integration) => {
          try {
            return [integration.id, await getGoogleCalendarSelections(integration.id)] as const;
          } catch {
            return [integration.id, []] as const;
          }
        }));
        if (active) setCalendarsByAccount(Object.fromEntries(selections));
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  async function toggleAccount(integrationId: number) {
    if (expandedId === integrationId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(integrationId);
    if (calendarsByAccount[integrationId]) return;
    try {
      const calendars = await getGoogleCalendarSelections(integrationId);
      setCalendarsByAccount((current) => ({ ...current, [integrationId]: calendars }));
      setErrorAccountId(null);
    } catch {
      setErrorAccountId(integrationId);
    }
  }

  function toggleCalendar(integrationId: number, calendarId: string) {
    setCalendarsByAccount((current) => ({
      ...current,
      [integrationId]: (current[integrationId] ?? []).map((calendar) => (
        calendar.calendarId === calendarId ? { ...calendar, enabled: !calendar.enabled } : calendar
      )),
    }));
  }

  async function saveSelections(integrationId: number) {
    setSavingId(integrationId);
    try {
      const result = await updateGoogleCalendarSelections(
        integrationId,
        (calendarsByAccount[integrationId] ?? [])
          .filter((calendar) => calendar.enabled)
          .map((calendar) => calendar.calendarId),
      );
      setCalendarsByAccount((current) => ({ ...current, [integrationId]: result }));
      setErrorAccountId(null);
    } catch {
      setErrorAccountId(integrationId);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <p className="text-xs font-bold text-[var(--foreground)]">Google 계정</p>
        <button type="button" onClick={() => window.location.assign(getGoogleCalendarAuthorizationUrl())} className="text-xs font-bold text-[var(--primary-strong)]">+ 연결</button>
      </div>
      {isLoading && <p className="border-t border-[var(--border)] px-3 py-3 text-xs text-[var(--muted)]">연결 상태 확인 중</p>}
      {!isLoading && integrations.length === 0 && <p className="border-t border-[var(--border)] px-3 py-3 text-xs text-[var(--muted)]">연결된 Google 계정이 없습니다.</p>}
      {!isLoading && integrations.map((integration) => <AccountGroup
        key={integration.id}
        integration={integration}
        calendars={calendarsByAccount[integration.id]}
        isExpanded={expandedId === integration.id}
        hasError={errorAccountId === integration.id}
        isSaving={savingId === integration.id}
        onToggle={() => void toggleAccount(integration.id)}
        onToggleCalendar={(calendarId) => toggleCalendar(integration.id, calendarId)}
        onSave={() => void saveSelections(integration.id)}
      />)}
      {justConnected && <span className="sr-only" aria-live="polite">Google Calendar 연결이 완료되었습니다.</span>}
    </section>
  );
}

function AccountGroup({ integration, calendars, isExpanded, hasError, isSaving, onToggle, onToggleCalendar, onSave }: {
  integration: GoogleCalendarIntegration;
  calendars: GoogleCalendarSelection[] | undefined;
  isExpanded: boolean;
  hasError: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onToggleCalendar: (calendarId: string) => void;
  onSave: () => void;
}) {
  const color = accountColor(integration, calendars);

  return <div className="border-t border-[var(--border)]">
    <button type="button" onClick={onToggle} aria-expanded={isExpanded} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
      <span aria-hidden="true" className="text-xs text-[var(--muted)]">{isExpanded ? "⌃" : "⌄"}</span>
      {color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]">{integration.email ?? "Google 계정"}</span>
      {!integration.connected && <span className="text-[10px] text-[#d9363e]">연결 필요</span>}
    </button>
    {isExpanded && integration.connected && !calendars && !hasError && <p className="px-3 pb-3 text-xs text-[var(--muted)]">캘린더 목록을 불러오는 중</p>}
    {isExpanded && hasError && <div className="px-3 pb-3"><p className="text-xs text-[var(--muted)]">목록을 불러오지 못했습니다.</p><button type="button" onClick={() => window.location.assign(getGoogleCalendarAuthorizationUrl())} className="mt-2 text-xs font-bold text-[var(--primary-strong)] underline underline-offset-4">연결 복구</button></div>}
    {isExpanded && calendars && <div className="space-y-1.5 px-3 pb-3">
      {calendars.map((calendar) => <label key={calendar.calendarId} className="flex cursor-pointer items-center gap-2 text-xs text-[var(--foreground)]"><input type="checkbox" checked={calendar.enabled} onChange={() => onToggleCalendar(calendar.calendarId)} className="h-3.5 w-3.5 accent-[var(--primary)]" /><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.color ?? "var(--primary)" }} /><span className="min-w-0 flex-1 truncate">{calendar.name}</span>{calendar.primary && <span className="text-[10px] text-[var(--muted)]">기본</span>}</label>)}
      <button type="button" onClick={onSave} disabled={isSaving} className="mt-2 h-8 rounded-md border border-[var(--border)] px-2.5 text-xs font-bold text-[var(--primary-strong)] disabled:opacity-60">{isSaving ? "저장 중" : "선택 저장"}</button>
    </div>}
  </div>;
}

function accountColor(
  integration: GoogleCalendarIntegration,
  calendars: GoogleCalendarSelection[] | undefined,
) {
  const enabledCalendars = calendars?.filter((calendar) => calendar.enabled) ?? [];

  return enabledCalendars.find((calendar) => calendar.primary)?.color
    ?? enabledCalendars.find((calendar) => calendar.name === integration.email)?.color;
}
