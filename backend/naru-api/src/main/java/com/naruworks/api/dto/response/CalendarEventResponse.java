package com.naruworks.api.dto.response;

import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;

import java.time.LocalDateTime;

public record CalendarEventResponse(
        Long id,
        String title,
        String description,
        LocalDateTime startAt,
        LocalDateTime endAt,
        boolean allDay,
        String location,
        String color,
        CalendarEventRecurrenceRule recurrenceRule,
        LocalDateTime recurrenceEndAt,
        CalendarEventStatus status
) {

    public static CalendarEventResponse from(CalendarEvent event) {
        return new CalendarEventResponse(
                event.getId(),
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                event.getRecurrenceEndAt(),
                event.getStatus()
        );
    }
}
