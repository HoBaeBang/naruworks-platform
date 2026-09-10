package com.naruworks.core.model;

import java.time.LocalDateTime;

/** Google Calendar API에서 읽은 일정의 제공자 중립 표현이다. */
public record GoogleCalendarEvent(
        String eventId,
        String title,
        String description,
        LocalDateTime startAt,
        LocalDateTime endAt,
        boolean allDay,
        String location,
        String color,
        LocalDateTime updatedAt
) {
}
