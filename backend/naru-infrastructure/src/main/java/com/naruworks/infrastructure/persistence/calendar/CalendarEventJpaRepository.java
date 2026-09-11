package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface CalendarEventJpaRepository extends JpaRepository<CalendarEventEntity, Long> {

    @Query("""
            select event
            from CalendarEventEntity event
            where event.calendarId in :calendarIds
              and event.status = :status
              and (
                    (event.recurrenceRule = :none
                     and event.startAt < :to
                     and event.endAt > :from)
                 or (event.recurrenceRule <> :none
                     and event.startAt < :to
                     and (event.recurrenceEndAt is null or event.recurrenceEndAt >= :from))
              )
            order by event.startAt asc
            """)
    List<CalendarEventEntity> findDisplayCandidates(
            @Param("calendarIds") List<Long> calendarIds,
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to,
            @Param("none") CalendarEventRecurrenceRule none,
            @Param("status") CalendarEventStatus status
    );

    Optional<CalendarEventEntity> findById(Long id);
}
