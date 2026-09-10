package com.naruworks.core.port;

import com.naruworks.domain.model.ExternalCalendarEvent;
import java.time.LocalDateTime;
import java.util.List;

public interface ExternalCalendarEventReader {

    List<ExternalCalendarEvent> findAllDisplayEvents(Long memberId, LocalDateTime from, LocalDateTime to);
}
