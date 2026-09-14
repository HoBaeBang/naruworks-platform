package com.naruworks.core.model;

import java.util.List;

/** Google Calendar 증분 조회 한 번의 변경분과 다음 동기화 기준점 */
public record GoogleCalendarSyncResult(
        List<GoogleCalendarEvent> events,
        List<String> cancelledEventIds,
        String nextSyncToken,
        boolean syncTokenExpired
) {
    public static GoogleCalendarSyncResult expired() {
        return new GoogleCalendarSyncResult(List.of(), List.of(), null, true);
    }
}
