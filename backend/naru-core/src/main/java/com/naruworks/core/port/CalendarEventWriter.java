package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarEvent;

public interface CalendarEventWriter {

    CalendarEvent save(CalendarEvent event);

    CalendarEvent update(Long memberId, CalendarEvent event);

    void delete(Long memberId, Long id);
}
