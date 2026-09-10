package com.naruworks.api.dto.response;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.time.LocalDateTime;
import java.util.Optional;

/** Google Calendar 연결 상태를 위한 응답 DTO. OAuth token은 절대 응답에 포함하지 않는다. */
public record GoogleCalendarIntegrationResponse(
        boolean connected,
        String email,
        CalendarIntegrationStatus status,
        LocalDateTime lastSyncedAt
) {

    public static GoogleCalendarIntegrationResponse from(Optional<CalendarIntegration> integration) {
        return integration
                .map(item -> new GoogleCalendarIntegrationResponse(
                        item.getStatus() == CalendarIntegrationStatus.CONNECTED,
                        item.getProviderEmail(),
                        item.getStatus(),
                        item.getLastSyncedAt()
                ))
                .orElseGet(() -> new GoogleCalendarIntegrationResponse(false, null, null, null));
    }
}
