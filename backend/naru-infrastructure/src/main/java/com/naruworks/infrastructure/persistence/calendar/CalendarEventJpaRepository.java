package com.naruworks.infrastructure.persistence.calendar;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface CalendarEventJpaRepository extends JpaRepository<CalendarEventEntity, Long> {

    List<CalendarEventEntity> findAllByStartAtLessThanAndEndAtGreaterThanOrderByStartAtAsc(
            LocalDateTime to,
            LocalDateTime from
    );
}
