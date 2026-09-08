package com.naruworks.infrastructure.persistence.calendar;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface CalendarHolidayOverrideJpaRepository
        extends JpaRepository<CalendarHolidayOverrideEntity, Long> {

    List<CalendarHolidayOverrideEntity> findAllByHolidayDateBetweenOrderByHolidayDate(
            LocalDate from,
            LocalDate to
    );
}
