package com.naruworks.core.model;

/** Google 계정의 캘린더와 NaruWorks 표시 선택 상태를 함께 표현한다. */
public record GoogleCalendarSelection(
        String calendarId,
        String name,
        String color,
        boolean primary,
        boolean enabled
) {
}
