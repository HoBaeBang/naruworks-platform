package com.naruworks.infrastructure.persistence.calendar;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface CalendarEventJpaRepository extends JpaRepository<CalendarEventEntity, Long> {

    List<CalendarEventEntity> findAllByMemberIdAndStartAtLessThanAndEndAtGreaterThanOrderByStartAtAsc(
            Long memberId,
            LocalDateTime to,
            LocalDateTime from
    );

    Optional<CalendarEventEntity> findByIdAndMemberId(Long id, Long memberId);
}
