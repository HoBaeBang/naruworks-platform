export type CalendarEvent = {
    id: number;
    title: string;
    description: string | null;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string | null;
    color: string;
    recurrenceRule: "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY" | "LUNAR_YEARLY";
    recurrenceEndAt: string | null;
    status: "ACTIVE" | "CANCELLED";
    occurrenceKey: string;
    occurrenceStartAt: string;
    originalOccurrence: boolean;
};

export type CalendarEventCreateRequest = {
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string;
    color: string;
    recurrenceRule: "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY" | "LUNAR_YEARLY";
    recurrenceEndAt: string | null;
};

export type CalendarEventUpdateRequest = CalendarEventCreateRequest;

export type CalendarEventOccurrenceScope = "THIS" | "THIS_AND_FOLLOWING" | "ALL";
