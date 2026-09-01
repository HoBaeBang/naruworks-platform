import type {
  CalendarEvent,
  CalendarEventCreateRequest,
  CalendarEventUpdateRequest,
} from "@/types/calendar";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export class CalendarApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      throw new CalendarApiError(`API request failed: ${path}`, response.status);
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
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        throw new CalendarApiError("Calendar event create failed", response.status);
    }

    return response.json() as Promise<CalendarEvent>;
}

export async function updateCalendarEvent(
  id: number,
  request: CalendarEventUpdateRequest,
): Promise<CalendarEvent> {
  const response = await fetch(`${API_BASE_URL}/api/calendar/events/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new CalendarApiError("Calendar event update failed", response.status);
  }

  return response.json() as Promise<CalendarEvent>;
}

export async function deleteCalendarEvent(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/calendar/events/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new CalendarApiError("Calendar event delete failed", response.status);
  }
}
