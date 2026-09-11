"use client";

import { useEffect, useState } from "react";
import { addCalendarMember, createSharedCalendar, getCalendars, type CalendarMembership } from "@/lib/calendars-api";
import { CalendarGoogleIntegration } from "@/components/calendar/calendar-google-integration";

type CalendarSidebarProps = {
  justConnected: boolean;
  selectedCalendar: CalendarMembership | null;
  onCalendarSelected: (calendar: CalendarMembership | null) => void;
};

export function CalendarSidebar({ justConnected, selectedCalendar, onCalendarSelected }: CalendarSidebarProps) {
  const [calendars, setCalendars] = useState<CalendarMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [inviteCalendarId, setInviteCalendarId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getCalendars()
        .then((result) => {
          setCalendars(result);
          const personal = result.find((calendar) => calendar.type === "PERSONAL");
          if (selectedCalendar === null && personal) onCalendarSelected(personal);
        })
        .catch(() => setMessage("내 캘린더 목록을 불러오지 못했습니다."))
        .finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onCalendarSelected, selectedCalendar]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await createSharedCalendar(name);
      setName("");
      setIsCreating(false);
      setCalendars((current) => [...current, created]);
      onCalendarSelected(created);
    } catch { setMessage("공유 캘린더를 만들지 못했습니다."); }
  }

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inviteCalendarId === null) return;
    try {
      await addCalendarMember(inviteCalendarId, email, role);
      setEmail("");
      setInviteCalendarId(null);
      setMessage("회원이 공유 캘린더에 추가되었습니다.");
    } catch { setMessage("승인된 회원 이메일과 권한을 확인해주세요."); }
  }

  return (
    <aside className="flex flex-col gap-3">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-[var(--foreground)]">내 캘린더</p>
          <button type="button" onClick={() => setIsCreating((current) => !current)} className="text-xs font-bold text-[var(--primary-strong)]">+</button>
        </div>
        {isLoading && <p className="mt-3 text-xs text-[var(--muted)]">불러오는 중</p>}
        {!isLoading && <div className="mt-3 space-y-1">
          {calendars.map((calendar) => (
            <div key={calendar.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--primary-soft)]">
                <input type="radio" name="naru-calendar" checked={selectedCalendar?.id === calendar.id} onChange={() => onCalendarSelected(calendar)} className="accent-[var(--primary)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />
                <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                {calendar.type === "SHARED" && <span className="text-[10px] text-[var(--muted)]">{roleLabel(calendar.role)}</span>}
              </label>
              {calendar.type === "SHARED" && calendar.role === "OWNER" && (
                <button type="button" onClick={() => setInviteCalendarId(calendar.id)} className="ml-7 text-[10px] font-bold text-[var(--primary-strong)]">회원 초대</button>
              )}
            </div>
          ))}
        </div>}
        {isCreating && <form onSubmit={handleCreate} className="mt-3 flex gap-1.5 border-t border-[var(--border)] pt-3"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="공유 캘린더 이름" required className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs outline-none focus:border-[var(--primary)]" /><button className="text-xs font-bold text-[var(--primary-strong)]">생성</button></form>}
        {inviteCalendarId !== null && <form onSubmit={handleInvite} className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="승인된 회원 이메일" required className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs outline-none focus:border-[var(--primary)]" /><select value={role} onChange={(event) => setRole(event.target.value as "EDITOR" | "VIEWER")} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"><option value="EDITOR">수정 가능</option><option value="VIEWER">보기만</option></select><button className="text-xs font-bold text-[var(--primary-strong)]">초대</button></form>}
        {message && <p className="mt-3 text-[11px] leading-4 text-[var(--muted)]">{message}</p>}
      </section>
      <CalendarGoogleIntegration justConnected={justConnected} />
    </aside>
  );
}

function roleLabel(role: CalendarMembership["role"]) {
  return role === "OWNER" ? "소유자" : role === "EDITOR" ? "수정" : "보기";
}
