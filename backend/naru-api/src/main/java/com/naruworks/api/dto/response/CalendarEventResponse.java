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
                event.id(),
                event.title(),
                event.description(),
                event.startAt(),
                event.endAt(),
                event.allDay(),
                event.location(),
                event.color(),
                event.recurrenceRule(),
                event.recurrenceEndAt(),
                event.status()
        );
    }
}
