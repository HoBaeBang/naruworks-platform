import type {
  CalendarEvent,
  CalendarEventCreateRequest,
  CalendarEventUpdateRequest,
} from "@/types/calendar";

const API_BASE_URL =
  typeof window === "undefined"
    ? process.env.CALENDAR_API_BASE_URL ??
      process.env.CATALOG_API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://backend:8080"
    : "";

async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${path}`);
    }

    return response.json() as Promise<T>;
}

export async function getCalendarEvents(
    from: string,
    to: string,
): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({ from, to });

    return fetchJson<CalendarEvent[]>(`/api/calendar/events?${params}`);
}

export async function createCalendarEvent(
    request: CalendarEventCreateRequest,
): Promise<CalendarEvent> {
    const response = await fetch(`${API_BASE_URL}/api/calendar/events`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new Error("Calendar event create failed");
    }

    return response.json() as Promise<CalendarEvent>;
}

export async function updateCalendarEvent(
  id: number,
  request: CalendarEventUpdateRequest,
): Promise<CalendarEvent> {
  const response = await fetch(`${API_BASE_URL}/api/calendar/events/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error("Calendar event update failed");
  }

  return response.json() as Promise<CalendarEvent>;
}

export async function deleteCalendarEvent(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/calendar/events/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Calendar event delete failed");
  }
}
