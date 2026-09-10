package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarIntegrationCalendar;
import java.util.List;

public interface CalendarIntegrationCalendarWriter {

    List<CalendarIntegrationCalendar> saveAll(List<CalendarIntegrationCalendar> calendars);
}
