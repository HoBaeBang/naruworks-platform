package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarEvent;

import java.time.LocalDateTime;
import java.util.List;

public interface CalendarEventReader {

    List<CalendarEvent> findEvents(List<Long> calendarIds, LocalDateTime from, LocalDateTime to);

    CalendarEvent findEvent(Long id);
}
