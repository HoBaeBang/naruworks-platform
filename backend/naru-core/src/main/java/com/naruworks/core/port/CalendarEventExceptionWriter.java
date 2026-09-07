package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarEventException;

public interface CalendarEventExceptionWriter {

    CalendarEventException save(CalendarEventException exception);

    void deleteAllByCalendarEventId(Long calendarEventId);
}
