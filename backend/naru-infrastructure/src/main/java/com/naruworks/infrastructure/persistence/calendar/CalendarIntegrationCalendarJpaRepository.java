package com.naruworks.infrastructure.persistence.calendar;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarIntegrationCalendarJpaRepository
        extends JpaRepository<CalendarIntegrationCalendarEntity, Long> {

    List<CalendarIntegrationCalendarEntity> findAllByCalendarIntegrationIdOrderByCalendarNameAsc(
            Long calendarIntegrationId
    );
}
