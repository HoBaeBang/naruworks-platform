const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export type CalendarMembership = {
  id: number;
  name: string;
  type: "PERSONAL" | "SHARED";
  ownerMemberId: number;
  role: "OWNER" | "EDITOR" | "VIEWER";
  displayColor: string;
  defaultCalendar: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error("캘린더 요청에 실패했습니다.");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getCalendars(): Promise<CalendarMembership[]> {
  return request<CalendarMembership[]>("/api/calendars", { cache: "no-store" });
}

export function createCalendar(
  name: string,
  shared: boolean,
  displayColor: string,
): Promise<CalendarMembership> {
  return request<CalendarMembership>("/api/calendars", {
    method: "POST",
    body: JSON.stringify({ name, shared, displayColor }),
  });
}

export function deleteCalendar(calendarId: number): Promise<void> {
  return request<void>(`/api/calendars/${calendarId}`, { method: "DELETE" });
}

export type CalendarInvitationLink = { inviteUrl: string; expiresAt: string };
export type CalendarInvitationPreview = { calendarId: number; calendarName: string; ownerDisplayName: string; role: "EDITOR" | "VIEWER"; expiresAt: string };
export type CalendarMember = { memberId: number; displayName: string; email: string; role: CalendarMembership["role"] };

export function createCalendarInvitationLink(calendarId: number, role: "EDITOR" | "VIEWER"): Promise<CalendarInvitationLink> {
  return request<CalendarInvitationLink>(`/api/calendars/${calendarId}/invitation-links`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function getCalendarInvitationPreview(token: string): Promise<CalendarInvitationPreview> {
  return request<CalendarInvitationPreview>(`/api/calendars/invitation-links/preview?token=${encodeURIComponent(token)}`, { cache: "no-store" });
}

export function acceptCalendarInvitation(token: string): Promise<void> {
  return request<void>("/api/calendars/invitation-links/accept", { method: "POST", body: JSON.stringify({ token }) });
}

export function getCalendarMembers(calendarId: number): Promise<CalendarMember[]> {
  return request<CalendarMember[]>(`/api/calendars/${calendarId}/members`, { cache: "no-store" });
}

export function removeCalendarMember(calendarId: number, memberId: number): Promise<void> {
  return request<void>(`/api/calendars/${calendarId}/members/${memberId}`, { method: "DELETE" });
}
