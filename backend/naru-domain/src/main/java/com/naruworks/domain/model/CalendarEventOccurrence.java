package com.naruworks.domain.model;

import java.time.LocalDateTime;

/**
 * 조회 기간 안에서 계산된 일정 발생 건이다.
 * 반복 일정도 DB에는 원본 일정 하나만 저장하고, 이 객체로 화면에 필요한 발생 건만 만든다.
 */
public record CalendarEventOccurrence(
        CalendarEvent event,
        LocalDateTime occurrenceStartAt,
        boolean originalOccurrence
) {

    public static CalendarEventOccurrence single(CalendarEvent event) {
        return new CalendarEventOccurrence(event, event.getStartAt(), true);
    }

    public static CalendarEventOccurrence recurring(CalendarEvent event, boolean originalOccurrence) {
        return new CalendarEventOccurrence(event, event.getStartAt(), originalOccurrence);
    }

    public String occurrenceKey() {
        return event.getId() + ":" + occurrenceStartAt;
    }
}
