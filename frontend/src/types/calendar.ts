export type CalendarEvent = {
    id: number;
    title: string;
    description: string | null;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string | null;
    color: string;
    recurrenceRule: "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY";
    recurrenceEndAt: string | null;
    status: "ACTIVE" | "CANCELLED";
};

export type CalendarEventCreateRequest = {
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string;
    color: string;
    recurrenceRule: "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY";
    recurrenceEndAt: string | null;
};
