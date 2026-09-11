package com.naruworks.infrastructure.persistence.calendar;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarMemberJpaRepository extends JpaRepository<CalendarMemberEntity, Long> {

    List<CalendarMemberEntity> findAllByMemberId(Long memberId);

    Optional<CalendarMemberEntity> findByCalendarIdAndMemberId(Long calendarId, Long memberId);
}
