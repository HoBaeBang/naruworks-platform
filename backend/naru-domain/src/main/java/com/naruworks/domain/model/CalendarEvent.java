package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import com.naruworks.domain.value.LunarDate;
import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class CalendarEvent {

    private final Long id;
    private final Long calendarId;
    private final Long createdByMemberId;
    private final String title;
    private final String description;
    private final LocalDateTime startAt;
    private final LocalDateTime endAt;
    private final boolean allDay;
    private final String location;
    private final String color;
    private final CalendarEventRecurrenceRule recurrenceRule;
    private final LunarDate recurrenceLunarDate;
    private final LocalDateTime recurrenceEndAt;
    private final CalendarEventStatus status;

    /**
     * 캘린더 도입 전 테스트와 순수 반복 계산에서 사용하는 호환 생성자다.
     * 저장 직전 CalendarService가 실제 캘린더 식별자와 생성자를 확정한다.
     */
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
        return of(id, memberId, memberId, title, description, startAt, endAt, allDay, location, color,
                recurrenceRule, null, recurrenceEndAt, status);
    }

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
            LunarDate recurrenceLunarDate,
            LocalDateTime recurrenceEndAt,
            CalendarEventStatus status
    ) {
        return of(id, memberId, memberId, title, description, startAt, endAt, allDay, location, color,
                recurrenceRule, recurrenceLunarDate, recurrenceEndAt, status);
    }

    public static CalendarEvent of(
            Long id,
            Long calendarId,
            Long createdByMemberId,
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
        return of(
                id,
                calendarId,
                createdByMemberId,
                title,
                description,
                startAt,
                endAt,
                allDay,
                location,
                color,
                recurrenceRule,
                null,
                recurrenceEndAt,
                status
        );
    }

    public static CalendarEvent of(
            Long id,
            Long calendarId,
            Long createdByMemberId,
            String title,
            String description,
            LocalDateTime startAt,
            LocalDateTime endAt,
            boolean allDay,
            String location,
            String color,
            CalendarEventRecurrenceRule recurrenceRule,
            LunarDate recurrenceLunarDate,
            LocalDateTime recurrenceEndAt,
            CalendarEventStatus status
    ) {
        return CalendarEvent.builder()
                .id(id)
                .calendarId(calendarId)
                .createdByMemberId(createdByMemberId)
                .title(title)
                .description(description)
                .startAt(startAt)
                .endAt(endAt)
                .allDay(allDay)
                .location(location)
                .color(color)
                .recurrenceRule(recurrenceRule)
                .recurrenceLunarDate(recurrenceLunarDate)
                .recurrenceEndAt(recurrenceEndAt)
                .status(status)
                .build();
    }
}
