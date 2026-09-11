package com.naruworks.api.dto.response;

import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.model.CalendarEventOccurrence;
import com.naruworks.domain.model.ExternalCalendarEvent;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;

import java.time.LocalDateTime;

public record CalendarEventResponse(
        Long id,
        Long calendarId,
        String title,
        String description,
        LocalDateTime startAt,
        LocalDateTime endAt,
        boolean allDay,
        String location,
        String color,
        CalendarEventRecurrenceRule recurrenceRule,
        LocalDateTime recurrenceEndAt,
        CalendarEventStatus status,
        String occurrenceKey,
        LocalDateTime occurrenceStartAt,
        boolean originalOccurrence,
        String source,
        boolean readOnly
) {

    public static CalendarEventResponse from(CalendarEvent event) {
        return from(CalendarEventOccurrence.single(event));
    }

    public static CalendarEventResponse from(CalendarEventOccurrence occurrence) {
        return from(occurrence, false);
    }

    public static CalendarEventResponse from(CalendarEventOccurrence occurrence, boolean readOnly) {
        CalendarEvent event = occurrence.event();
        return new CalendarEventResponse(
                event.getId(),
                event.getCalendarId(),
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                event.getRecurrenceEndAt(),
                event.getStatus(),
                occurrence.occurrenceKey(),
                occurrence.occurrenceStartAt(),
                occurrence.originalOccurrence(),
                "NARU",
                readOnly
        );
    }

    public static CalendarEventResponse from(ExternalCalendarEvent event) {
        return new CalendarEventResponse(
                event.getId(),
                null,
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE,
                "google:" + event.getId(),
                event.getStartAt(),
                true,
                "GOOGLE",
                true
        );
    }
}
