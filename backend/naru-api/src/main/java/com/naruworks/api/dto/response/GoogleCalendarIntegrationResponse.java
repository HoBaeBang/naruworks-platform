package com.naruworks.api.dto.response;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationStatus;

/** Google Calendar 연결 상태를 위한 응답 DTO. OAuth token은 절대 응답에 포함하지 않는다. */
public record GoogleCalendarIntegrationResponse(
        Long id,
        boolean connected,
        String email,
        CalendarIntegrationStatus status
) {

    public static GoogleCalendarIntegrationResponse from(CalendarIntegration integration) {
        return new GoogleCalendarIntegrationResponse(
                integration.getId(),
                integration.getStatus() == CalendarIntegrationStatus.CONNECTED,
                integration.getProviderEmail(),
                integration.getStatus()
        );
    }
}
