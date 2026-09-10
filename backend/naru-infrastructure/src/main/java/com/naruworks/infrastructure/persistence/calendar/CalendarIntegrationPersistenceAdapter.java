package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CalendarIntegrationPersistenceAdapter
        implements CalendarIntegrationReader, CalendarIntegrationWriter {

    private final CalendarIntegrationJpaRepository calendarIntegrationJpaRepository;

    @Override
    public Optional<CalendarIntegration> findByMemberIdAndProvider(
            Long memberId,
            CalendarIntegrationProvider provider
    ) {
        return calendarIntegrationJpaRepository.findByMemberIdAndProvider(memberId, provider)
                .map(CalendarIntegrationEntity::toDomain);
    }

    @Override
    public CalendarIntegration save(CalendarIntegration calendarIntegration) {
        return calendarIntegrationJpaRepository.save(CalendarIntegrationEntity.from(calendarIntegration))
                .toDomain();
    }
}
