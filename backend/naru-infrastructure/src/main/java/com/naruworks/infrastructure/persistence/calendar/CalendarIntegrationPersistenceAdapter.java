package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CalendarIntegrationPersistenceAdapter
        implements CalendarIntegrationReader, CalendarIntegrationWriter {

    private final CalendarIntegrationJpaRepository calendarIntegrationJpaRepository;

    @Override
    public List<CalendarIntegration> findAllByMemberIdAndProvider(
            Long memberId,
            CalendarIntegrationProvider provider
    ) {
        return calendarIntegrationJpaRepository.findAllByMemberIdAndProviderOrderByProviderEmailAsc(memberId, provider)
                .stream()
                .map(CalendarIntegrationEntity::toDomain)
                .toList();
    }

    @Override
    public Optional<CalendarIntegration> findByMemberIdAndProviderAndProviderAccountId(
            Long memberId,
            CalendarIntegrationProvider provider,
            String providerAccountId
    ) {
        return calendarIntegrationJpaRepository
                .findByMemberIdAndProviderAndProviderAccountId(memberId, provider, providerAccountId)
                .map(CalendarIntegrationEntity::toDomain);
    }

    @Override
    public Optional<CalendarIntegration> findByIdAndMemberId(Long integrationId, Long memberId) {
        return calendarIntegrationJpaRepository.findByIdAndMemberId(integrationId, memberId)
                .map(CalendarIntegrationEntity::toDomain);
    }

    @Override
    public CalendarIntegration save(CalendarIntegration calendarIntegration) {
        return calendarIntegrationJpaRepository.save(CalendarIntegrationEntity.from(calendarIntegration))
                .toDomain();
    }
}
