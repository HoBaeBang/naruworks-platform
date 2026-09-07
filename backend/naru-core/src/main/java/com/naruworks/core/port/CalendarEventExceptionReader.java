package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarEventException;
import java.util.Collection;
import java.util.List;

public interface CalendarEventExceptionReader {

    List<CalendarEventException> findAllByCalendarEventIds(Collection<Long> calendarEventIds);
}
