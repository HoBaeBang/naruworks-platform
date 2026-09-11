package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarEvent;

public interface CalendarEventWriter {

    CalendarEvent save(CalendarEvent event);

    CalendarEvent update(CalendarEvent event);

    void delete(Long id);
}
