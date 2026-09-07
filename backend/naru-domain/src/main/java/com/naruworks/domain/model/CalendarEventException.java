package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarEventExceptionType;
import java.time.LocalDateTime;

/** 반복 시리즈의 특정 발생 일정에만 적용하는 변경 기록 */
public record CalendarEventException(
        Long id,
        Long calendarEventId,
        LocalDateTime occurrenceStartAt,
        CalendarEventExceptionType type,
        String title,
        String description,
        LocalDateTime startAt,
        LocalDateTime endAt,
        boolean allDay,
        String location,
        String color
) {

    public static CalendarEventException cancelled(
            Long calendarEventId,
            LocalDateTime occurrenceStartAt
    ) {
        return new CalendarEventException(
                null,
                calendarEventId,
                occurrenceStartAt,
                CalendarEventExceptionType.CANCELLED,
                null,
                null,
                null,
                null,
                false,
                null,
                null
        );
    }

    public static CalendarEventException overridden(
            Long calendarEventId,
            LocalDateTime occurrenceStartAt,
            CalendarEvent event
    ) {
        return new CalendarEventException(
                null,
                calendarEventId,
                occurrenceStartAt,
                CalendarEventExceptionType.OVERRIDDEN,
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor()
        );
    }
}
