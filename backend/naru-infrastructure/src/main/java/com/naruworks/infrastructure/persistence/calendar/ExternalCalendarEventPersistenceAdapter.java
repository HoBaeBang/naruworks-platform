package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.ExternalCalendarEventReader;
import com.naruworks.core.port.ExternalCalendarEventWriter;
import com.naruworks.domain.model.ExternalCalendarEvent;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ExternalCalendarEventPersistenceAdapter
        implements ExternalCalendarEventReader, ExternalCalendarEventWriter {

    private final ExternalCalendarEventJpaRepository externalCalendarEventJpaRepository;

    @Override
    public List<ExternalCalendarEvent> findAllDisplayEvents(Long memberId, LocalDateTime from, LocalDateTime to) {
        return externalCalendarEventJpaRepository.findAllDisplayEvents(memberId, from, to)
                .stream()
                .map(ExternalCalendarEventEntity::toDomain)
                .toList();
    }

    @Override
    public void upsertAll(List<ExternalCalendarEvent> events) {
        events.forEach(event -> externalCalendarEventJpaRepository.upsert(
                event.getCalendarIntegrationCalendarId(),
                event.getProviderEventId(),
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getProviderUpdatedAt(),
                event.getCreatedAt(),
                event.getUpdatedAt()
        ));
    }
}
