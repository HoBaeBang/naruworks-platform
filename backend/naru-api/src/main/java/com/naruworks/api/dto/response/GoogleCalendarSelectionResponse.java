package com.naruworks.api.dto.response;

import com.naruworks.core.model.GoogleCalendarSelection;

/** Google 계정의 캘린더와 NaruWorks 표시 선택 상태를 반환하는 DTO */
public record GoogleCalendarSelectionResponse(
        String calendarId,
        String name,
        String color,
        boolean primary,
        boolean enabled
) {

    public static GoogleCalendarSelectionResponse from(GoogleCalendarSelection selection) {
        return new GoogleCalendarSelectionResponse(
                selection.calendarId(),
                selection.name(),
                selection.color(),
                selection.primary(),
                selection.enabled()
        );
    }
}
