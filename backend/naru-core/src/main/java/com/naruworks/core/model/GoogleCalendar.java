package com.naruworks.core.model;

/** Google Calendar API가 반환한 사용 가능한 캘린더 한 건 */
public record GoogleCalendar(
        String calendarId,
        String name,
        String color,
        boolean primary
) {
}
