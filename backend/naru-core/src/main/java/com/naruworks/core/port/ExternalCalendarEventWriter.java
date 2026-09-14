package com.naruworks.core.port;

import com.naruworks.domain.model.ExternalCalendarEvent;
import java.util.List;

public interface ExternalCalendarEventWriter {

    void upsertAll(List<ExternalCalendarEvent> events);

    void deleteByCalendarIntegrationCalendarIdAndProviderEventIds(
            Long calendarIntegrationCalendarId,
            List<String> providerEventIds
    );

    void deleteAllByCalendarIntegrationCalendarId(Long calendarIntegrationCalendarId);
}
