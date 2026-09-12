"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createCalendar,
  deleteCalendar,
  createCalendarInvitationLink,
  getCalendarMembers,
  getCalendars,
  removeCalendarMember,
  type CalendarMember,
  type CalendarMembership,
} from "@/lib/calendars-api";
import { CalendarGoogleIntegration } from "@/components/calendar/calendar-google-integration";
import { NaruSelect } from "@/components/ui/naru-select";

type CalendarSidebarProps = {
  justConnected: boolean;
  activeCalendar: CalendarMembership | null;
  visibleCalendarIds: ReadonlySet<number>;
  onActiveCalendarChange: (calendar: CalendarMembership | null) => void;
  onVisibleCalendarIdsChange: (calendarIds: Set<number>) => void;
  onCalendarsChanged: (calendars: CalendarMembership[]) => void;
};

export function CalendarSidebar({
  justConnected,
  activeCalendar,
  visibleCalendarIds,
  onActiveCalendarChange,
  onVisibleCalendarIdsChange,
  onCalendarsChanged,
}: CalendarSidebarProps) {
  const [calendars, setCalendars] = useState<CalendarMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [displayColor, setDisplayColor] = useState(CALENDAR_DISPLAY_COLORS[0]);
  const [manageCalendarId, setManageCalendarId] = useState<number | null>(null);
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [inviteUrl, setInviteUrl] = useState("");
  const [members, setMembers] = useState<CalendarMember[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const publishCalendars = useCallback((nextCalendars: CalendarMembership[]) => {
    setCalendars(nextCalendars);
    onCalendarsChanged(nextCalendars);
  }, [onCalendarsChanged]);

  const loadCalendars = useCallback(async () => {
    try {
      const result = await getCalendars();
      publishCalendars(result);
      setDisplayColor(nextCalendarDisplayColor(result));
      onVisibleCalendarIdsChange(new Set(result.map((calendar) => calendar.id)));
      onActiveCalendarChange(result.find((calendar) => calendar.defaultCalendar) ?? result[0] ?? null);
    } catch {
      setMessage("내 캘린더 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [onActiveCalendarChange, onVisibleCalendarIdsChange, publishCalendars]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCalendars();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCalendars]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await createCalendar(name, shared, displayColor);
      const nextCalendars = [...calendars, created];
      publishCalendars(nextCalendars);
      onVisibleCalendarIdsChange(new Set([...visibleCalendarIds, created.id]));
      onActiveCalendarChange(created);
      setName("");
      setShared(false);
      setDisplayColor(nextCalendarDisplayColor(nextCalendars));
      setIsCreating(false);
    } catch {
      setMessage("새 캘린더를 만들지 못했습니다.");
    }
  }

  function toggleVisibleCalendar(calendarId: number) {
    const nextCalendarIds = new Set(visibleCalendarIds);
    if (nextCalendarIds.has(calendarId)) nextCalendarIds.delete(calendarId);
    else nextCalendarIds.add(calendarId);
    onVisibleCalendarIdsChange(nextCalendarIds);
  }

  async function openMemberManagement(calendarId: number) {
    setManageCalendarId(calendarId);
    setInviteUrl("");
    try {
      setMembers(await getCalendarMembers(calendarId));
    } catch {
      setMessage("공유 중인 회원 목록을 불러오지 못했습니다.");
    }
  }

  async function createInviteLink() {
    if (manageCalendarId === null) return;
    try {
      const result = await createCalendarInvitationLink(manageCalendarId, role);
      setInviteUrl(result.inviteUrl);
      setMessage("7일 동안 사용할 수 있는 초대 링크를 만들었습니다.");
    } catch {
      setMessage("초대 링크를 만들지 못했습니다.");
    }
  }

  async function removeMember(memberId: number) {
    if (manageCalendarId === null) return;
    try {
      await removeCalendarMember(manageCalendarId, memberId);
      setMembers((current) => current.filter((member) => member.memberId !== memberId));
    } catch {
      setMessage("구성원을 제거하지 못했습니다.");
    }
  }

  async function handleDeleteCalendar(calendar: CalendarMembership) {
    const isShared = calendar.type === "SHARED";
    const confirmed = window.confirm(
      isShared
        ? `공유 캘린더 '${calendar.name}'와 모든 일정, 구성원 정보를 삭제할까요?`
        : `개인 캘린더 '${calendar.name}'와 모든 일정을 삭제할까요?`,
    );
    if (!confirmed) return;

    try {
      await deleteCalendar(calendar.id);
      const nextCalendars = calendars.filter((current) => current.id !== calendar.id);
      publishCalendars(nextCalendars);
      const nextVisibleCalendarIds = new Set(visibleCalendarIds);
      nextVisibleCalendarIds.delete(calendar.id);
      onVisibleCalendarIdsChange(nextVisibleCalendarIds);
      if (activeCalendar?.id === calendar.id) {
        onActiveCalendarChange(
          nextCalendars.find((current) => current.defaultCalendar) ?? nextCalendars[0] ?? null,
        );
      }
      setManageCalendarId((current) => current === calendar.id ? null : current);
    } catch {
      setMessage(
        calendar.type === "PERSONAL"
          ? "개인 캘린더는 하나 이상 유지해야 합니다."
          : "공유 캘린더를 삭제하지 못했습니다.",
      );
    }
  }

  return (
    <aside className="flex flex-col gap-3">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-[var(--foreground)]">내 캘린더</p>
          <button type="button" title="새 캘린더 만들기" onClick={() => setIsCreating((current) => !current)} className="grid h-7 w-7 place-items-center rounded-md text-base font-bold text-[var(--primary-strong)] hover:bg-[var(--primary-soft)]">+</button>
        </div>

        {isLoading && <p className="mt-3 text-xs text-[var(--muted)]">불러오는 중</p>}
        {!isLoading && <div className="mt-3 space-y-1">
          {calendars.map((calendar) => {
            const isActive = activeCalendar?.id === calendar.id;
            return <div key={calendar.id} className="rounded-md">
              <div className={["flex items-center gap-2 px-2 py-1.5 text-xs", isActive ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--primary-soft)]"].join(" ")}>
                <input type="checkbox" checked={visibleCalendarIds.has(calendar.id)} onChange={() => toggleVisibleCalendar(calendar.id)} aria-label={`${calendar.name} 표시 여부`} className="h-3.5 w-3.5 accent-[var(--primary)]" />
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.displayColor }} />
                <button type="button" onClick={() => onActiveCalendarChange(calendar)} className="min-w-0 flex-1 truncate text-left font-medium" title="새 일정 기본 캘린더로 선택">{calendar.name}</button>
                {isActive && <span className="text-[10px] font-bold text-[var(--primary-strong)]">작성</span>}
              </div>
              <div className="ml-7 flex items-center gap-2 pb-1 text-[10px] text-[var(--muted)]">
                {calendar.defaultCalendar && <span>기본</span>}
                {calendar.type === "SHARED" && <span>{roleLabel(calendar.role)}</span>}
                {calendar.type === "SHARED" && calendar.role === "OWNER" && <button type="button" onClick={() => void openMemberManagement(calendar.id)} className="font-bold text-[var(--primary-strong)]">구성원 관리</button>}
                {calendar.role === "OWNER" && <button type="button" onClick={() => void handleDeleteCalendar(calendar)} className="font-bold text-[#d9363e]">삭제</button>}
              </div>
            </div>;
          })}
        </div>}

        {isCreating && <form onSubmit={handleCreate} className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-bold text-[var(--foreground)]">새 캘린더</p>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="캘린더 이름" required className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--primary)]" />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="color" value={displayColor} onChange={(event) => setDisplayColor(event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />표시 색상</label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} className="accent-[var(--primary)]" />공유 캘린더</label>
          </div>
          <button className="h-9 w-full rounded-md bg-[var(--primary)] text-xs font-bold text-[#062b20]">생성</button>
        </form>}

        {manageCalendarId !== null && <section className="mt-3 space-y-2 border-t border-[var(--border)] pt-3"><div className="flex items-center justify-between"><p className="text-xs font-bold">구성원 관리</p><button type="button" onClick={() => setManageCalendarId(null)} className="text-xs text-[var(--muted)]">닫기</button></div><div className="flex gap-2"><NaruSelect value={role} onChange={(value) => setRole(value as "EDITOR" | "VIEWER")} ariaLabel="초대 권한" options={[{ value: "EDITOR", label: "수정 가능" }, { value: "VIEWER", label: "보기만" }]} compact className="min-w-0 flex-1" /><button type="button" onClick={() => void createInviteLink()} className="text-xs font-bold text-[var(--primary-strong)]">링크 만들기</button></div>{inviteUrl && <div className="flex gap-1"><input readOnly value={inviteUrl} className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[10px]" /><button type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)} className="text-xs font-bold text-[var(--primary-strong)]">복사</button></div>}<div className="space-y-1 pt-1">{members.map((member) => <div key={member.memberId} className="flex items-center gap-2 text-[11px]"><span className="min-w-0 flex-1 truncate">{member.displayName} · {roleLabel(member.role)}</span>{member.role !== "OWNER" && <button type="button" onClick={() => void removeMember(member.memberId)} className="text-[#d9363e]">제거</button>}</div>)}</div></section>}
        {message && <p className="mt-3 text-[11px] leading-4 text-[var(--muted)]">{message}</p>}
      </section>
      <CalendarGoogleIntegration
        justConnected={justConnected}
        reservedColors={calendars.map((calendar) => calendar.displayColor)}
      />
    </aside>
  );
}

function roleLabel(role: CalendarMembership["role"]) {
  return role === "OWNER" ? "소유자" : role === "EDITOR" ? "수정" : "보기";
}

const CALENDAR_DISPLAY_COLORS = [
  "#20b977",
  "#3b82f6",
  "#f4b942",
  "#e85d75",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#64748b",
];

function nextCalendarDisplayColor(calendars: CalendarMembership[]) {
  const usedColors = new Set(calendars.map((calendar) => calendar.displayColor.toLowerCase()));
  return CALENDAR_DISPLAY_COLORS.find((color) => !usedColors.has(color))
    ?? CALENDAR_DISPLAY_COLORS[calendars.length % CALENDAR_DISPLAY_COLORS.length];
}
