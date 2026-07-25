package com.naruworks.api.dto.request;

import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDateTime;

public record CalendarEventUpdateRequest(
        @NotBlank
        String title,

        String description,

        @NotNull
        LocalDateTime startAt,

        @NotNull
        LocalDateTime endAt,

        boolean allDay,

        String location,

        @NotBlank
        String color,

        @NotNull
        CalendarEventRecurrenceRule recurrenceRule,

        LocalDateTime recurrenceEndAt
) {

    public CalendarEvent toDomain(Long id) {
        return CalendarEvent.of(
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
                CalendarEventStatus.ACTIVE
        );
    }
}
