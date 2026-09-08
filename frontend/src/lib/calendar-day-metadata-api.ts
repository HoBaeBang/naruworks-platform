import { CalendarApiError } from "@/lib/calendar-api";
import type { CalendarDayMetadata } from "@/types/calendar-day-metadata";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export async function getCalendarDayMetadata(
  from: string,
  to: string,
): Promise<CalendarDayMetadata[]> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`${API_BASE_URL}/api/calendar/day-metadata?${params}`, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new CalendarApiError("Calendar day metadata request failed", response.status);
  }

  return response.json() as Promise<CalendarDayMetadata[]>;
}
