package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class CalendarEvent {

    private final Long id;
    private final Long memberId;
    private final String title;
    private final String description;
    private final LocalDateTime startAt;
    private final LocalDateTime endAt;
    private final boolean allDay;
    private final String location;
    private final String color;
    private final CalendarEventRecurrenceRule recurrenceRule;
    private final LocalDateTime recurrenceEndAt;
    private final CalendarEventStatus status;

    public static CalendarEvent of(
            Long id,
            Long memberId,
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
        return CalendarEvent.builder()
                .id(id)
                .memberId(memberId)
                .title(title)
                .description(description)
                .startAt(startAt)
                .endAt(endAt)
                .allDay(allDay)
                .location(location)
                .color(color)
                .recurrenceRule(recurrenceRule)
                .recurrenceEndAt(recurrenceEndAt)
                .status(status)
                .build();
    }
}
