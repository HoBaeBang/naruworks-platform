package com.naruworks.domain.model;

import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

/** 외부 캘린더 연결 안에서 사용자가 선택한 개별 제공자 캘린더 */
@Getter
@Builder(toBuilder = true)
public class CalendarIntegrationCalendar {

    private final Long id;
    private final Long calendarIntegrationId;
    private final String providerCalendarId;
    private final String calendarName;
    private final String calendarColor;
    private final boolean enabled;
    private final LocalDateTime lastSyncedAt;
    private final String syncToken;
    private final LocalDateTime createdAt;
    private final LocalDateTime updatedAt;

    public static CalendarIntegrationCalendar create(
            Long calendarIntegrationId,
            String providerCalendarId,
            String calendarName,
            String calendarColor,
            boolean enabled,
            LocalDateTime now
    ) {
        return CalendarIntegrationCalendar.builder()
                .calendarIntegrationId(calendarIntegrationId)
                .providerCalendarId(providerCalendarId)
                .calendarName(calendarName)
                .calendarColor(calendarColor)
                .enabled(enabled)
                .createdAt(now)
                .updatedAt(now)
                .build();
    }

    public CalendarIntegrationCalendar updateFromProvider(
            String calendarName,
            String calendarColor,
            boolean enabled,
            LocalDateTime now
    ) {
        return toBuilder()
                .calendarName(calendarName)
                .calendarColor(calendarColor)
                .enabled(enabled)
                .updatedAt(now)
                .build();
    }
}
