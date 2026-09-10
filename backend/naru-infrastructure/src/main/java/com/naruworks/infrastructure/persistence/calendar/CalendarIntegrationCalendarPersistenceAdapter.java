package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationCalendarWriter;
import com.naruworks.domain.model.CalendarIntegrationCalendar;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CalendarIntegrationCalendarPersistenceAdapter
        implements CalendarIntegrationCalendarReader, CalendarIntegrationCalendarWriter {

    private final CalendarIntegrationCalendarJpaRepository calendarIntegrationCalendarJpaRepository;

    @Override
    public List<CalendarIntegrationCalendar> findAllByCalendarIntegrationId(Long calendarIntegrationId) {
        return calendarIntegrationCalendarJpaRepository
                .findAllByCalendarIntegrationIdOrderByCalendarNameAsc(calendarIntegrationId)
                .stream()
                .map(CalendarIntegrationCalendarEntity::toDomain)
                .toList();
    }

    @Override
    public List<CalendarIntegrationCalendar> saveAll(List<CalendarIntegrationCalendar> calendars) {
        return calendarIntegrationCalendarJpaRepository.saveAll(
                        calendars.stream().map(CalendarIntegrationCalendarEntity::from).toList()
                )
                .stream()
                .map(CalendarIntegrationCalendarEntity::toDomain)
                .toList();
    }
}
