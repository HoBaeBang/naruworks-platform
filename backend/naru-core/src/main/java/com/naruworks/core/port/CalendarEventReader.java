package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarEvent;

import java.time.LocalDateTime;
import java.util.List;

public interface CalendarEventReader {

    List<CalendarEvent> findEvents(LocalDateTime from, LocalDateTime to);
}
