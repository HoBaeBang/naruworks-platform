const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export type GoogleCalendarIntegration = {
  connected: boolean;
  email: string | null;
  status: "CONNECTED" | "REVOKED" | "FAILED" | null;
  lastSyncedAt: string | null;
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
