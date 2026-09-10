package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarIntegrationCalendar;
import java.util.List;

public interface CalendarIntegrationCalendarReader {

    List<CalendarIntegrationCalendar> findAllByCalendarIntegrationId(Long calendarIntegrationId);
}
