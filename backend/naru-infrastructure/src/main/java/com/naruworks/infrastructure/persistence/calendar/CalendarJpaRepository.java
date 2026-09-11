package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.type.CalendarType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarJpaRepository extends JpaRepository<CalendarEntity, Long> {

    Optional<CalendarEntity> findByOwnerMemberIdAndType(Long ownerMemberId, CalendarType type);
}
