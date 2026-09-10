const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export type GoogleCalendarIntegration = {
  connected: boolean;
  email: string | null;
  status: "CONNECTED" | "REVOKED" | "FAILED" | null;
  lastSyncedAt: string | null;
};

export type GoogleCalendarSelection = {
  calendarId: string;
  name: string;
  color: string | null;
  primary: boolean;
  enabled: boolean;
};

export async function getGoogleCalendarIntegration(): Promise<GoogleCalendarIntegration> {
  const response = await fetch(`${apiBaseUrl}/api/calendar/integrations/google`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Google Calendar 연결 정보를 불러오지 못했습니다.");
  }

  return response.json() as Promise<GoogleCalendarIntegration>;
}

export function getGoogleCalendarAuthorizationUrl(): string {
  return `${apiBaseUrl}/api/calendar/integrations/google/authorize`;
}

export async function getGoogleCalendarSelections(): Promise<GoogleCalendarSelection[]> {
  const response = await fetch(`${apiBaseUrl}/api/calendar/integrations/google/calendars`, {
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Google Calendar 목록을 불러오지 못했습니다.");
  }

  return response.json() as Promise<GoogleCalendarSelection[]>;
}

export async function updateGoogleCalendarSelections(
  calendarIds: string[],
): Promise<GoogleCalendarSelection[]> {
  const response = await fetch(`${apiBaseUrl}/api/calendar/integrations/google/calendars`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ calendarIds }),
  });

  if (!response.ok) {
    throw new Error("Google Calendar 선택을 저장하지 못했습니다.");
  }

  return response.json() as Promise<GoogleCalendarSelection[]>;
}
