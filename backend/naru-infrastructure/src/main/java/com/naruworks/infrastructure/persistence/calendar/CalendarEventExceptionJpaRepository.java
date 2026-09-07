package com.naruworks.infrastructure.persistence.calendar;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarEventExceptionJpaRepository
        extends JpaRepository<CalendarEventExceptionEntity, Long> {

    List<CalendarEventExceptionEntity> findAllByCalendarEventIdIn(Collection<Long> calendarEventIds);

    Optional<CalendarEventExceptionEntity> findByCalendarEventIdAndOccurrenceStartAt(
            Long calendarEventId,
            LocalDateTime occurrenceStartAt
    );

    void deleteAllByCalendarEventId(Long calendarEventId);
}
