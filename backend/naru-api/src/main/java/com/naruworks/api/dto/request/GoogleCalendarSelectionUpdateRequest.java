package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Google Calendar에서 NaruWorks에 표시할 캘린더 목록을 바꾸는 요청 DTO */
public record GoogleCalendarSelectionUpdateRequest(
        @NotNull List<@NotBlank String> calendarIds
) {
}
