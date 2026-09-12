package com.naruworks.infrastructure.persistence.calendar;

import java.util.Optional;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarJpaRepository extends JpaRepository<CalendarEntity, Long> {

    Optional<CalendarEntity> findByOwnerMemberIdAndDefaultCalendarTrue(Long ownerMemberId);

    List<CalendarEntity> findAllByOwnerMemberId(Long ownerMemberId);
}
