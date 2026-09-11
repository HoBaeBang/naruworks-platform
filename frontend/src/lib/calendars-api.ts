const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export type CalendarMembership = {
  id: number;
  name: string;
  type: "PERSONAL" | "SHARED";
  ownerMemberId: number;
  role: "OWNER" | "EDITOR" | "VIEWER";
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error("캘린더 요청에 실패했습니다.");
  return response.json() as Promise<T>;
}

export function getCalendars(): Promise<CalendarMembership[]> {
  return request<CalendarMembership[]>("/api/calendars", { cache: "no-store" });
}

export function createSharedCalendar(name: string): Promise<CalendarMembership> {
  return request<CalendarMembership>("/api/calendars", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function addCalendarMember(
  calendarId: number,
  email: string,
  role: "EDITOR" | "VIEWER",
): Promise<CalendarMembership> {
  return request<CalendarMembership>(`/api/calendars/${calendarId}/members`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}
