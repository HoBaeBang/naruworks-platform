package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.type.CalendarIntegrationProvider;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarIntegrationJpaRepository
        extends JpaRepository<CalendarIntegrationEntity, Long> {

    Optional<CalendarIntegrationEntity> findByMemberIdAndProvider(
            Long memberId,
            CalendarIntegrationProvider provider
    );
}
