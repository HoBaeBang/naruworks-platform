package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarIntegrationJpaRepository
        extends JpaRepository<CalendarIntegrationEntity, Long> {

    List<CalendarIntegrationEntity> findAllByMemberIdAndProviderOrderByProviderEmailAsc(
            Long memberId,
            CalendarIntegrationProvider provider
    );

    List<CalendarIntegrationEntity> findAllByProviderAndStatus(
            CalendarIntegrationProvider provider,
            CalendarIntegrationStatus status
    );

    Optional<CalendarIntegrationEntity> findByMemberIdAndProviderAndProviderAccountId(
            Long memberId,
            CalendarIntegrationProvider provider,
            String providerAccountId
    );

    Optional<CalendarIntegrationEntity> findByIdAndMemberId(Long id, Long memberId);
}
