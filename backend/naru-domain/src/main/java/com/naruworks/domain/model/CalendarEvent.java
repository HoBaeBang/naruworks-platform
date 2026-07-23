package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;

import java.time.LocalDateTime;

public record CalendarEvent (
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
){
    public static CalendarEvent of(
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
        return new CalendarEvent(
                id,
                title,
                description,
                startAt,
                endAt,
                allDay,
                location,
                color,
                recurrenceRule,
                recurrenceEndAt,
                status
        );
    }
}
