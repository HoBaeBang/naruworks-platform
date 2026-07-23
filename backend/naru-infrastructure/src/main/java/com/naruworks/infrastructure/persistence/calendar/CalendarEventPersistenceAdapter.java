package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.domain.model.CalendarEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class CalendarEventPersistenceAdapter implements CalendarEventReader {

    private final CalendarEventJpaRepository calendarEventJpaRepository;

    public List<CalendarEvent> findEvents(LocalDateTime from, LocalDateTime to) {
        return calendarEventJpaRepository
                .findAllByStartAtLessThanAndEndAtGreaterThanOrderByStartAtAsc(to, from)
                .stream()
                .map(CalendarEventEntity::toDomain)
                .toList();
    }
}
