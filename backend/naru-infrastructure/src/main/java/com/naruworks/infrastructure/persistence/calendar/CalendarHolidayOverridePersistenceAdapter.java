package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarHolidayOverrideReader;
import com.naruworks.domain.model.CalendarHolidayOverride;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

@Component
@RequiredArgsConstructor
public class CalendarHolidayOverridePersistenceAdapter implements CalendarHolidayOverrideReader {

    private final CalendarHolidayOverrideJpaRepository calendarHolidayOverrideJpaRepository;

    @Override
    public List<CalendarHolidayOverride> findAllBetween(LocalDate from, LocalDate to) {
        return calendarHolidayOverrideJpaRepository
                .findAllByHolidayDateBetweenOrderByHolidayDate(from, to)
                .stream()
                .map(CalendarHolidayOverrideEntity::toDomain)
                .toList();
    }
}
