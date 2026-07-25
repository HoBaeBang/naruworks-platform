import type {
    CalendarEvent,
    CalendarEventCreateRequest,
} from "@/types/calendar";

const API_BASE_URL =
    process.env.CALENDAR_API_BASE_URL ??
    process.env.CATALOG_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:8081";

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
