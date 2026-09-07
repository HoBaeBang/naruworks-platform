package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarEventExceptionReader;
import com.naruworks.core.port.CalendarEventExceptionWriter;
import com.naruworks.domain.model.CalendarEventException;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CalendarEventExceptionPersistenceAdapter
        implements CalendarEventExceptionReader, CalendarEventExceptionWriter {

    private final CalendarEventExceptionJpaRepository calendarEventExceptionJpaRepository;

    @Override
    public List<CalendarEventException> findAllByCalendarEventIds(Collection<Long> calendarEventIds) {
        if (calendarEventIds.isEmpty()) {
            return List.of();
        }

        return calendarEventExceptionJpaRepository.findAllByCalendarEventIdIn(calendarEventIds)
                .stream()
                .map(CalendarEventExceptionEntity::toDomain)
                .toList();
    }

    @Override
    public CalendarEventException save(CalendarEventException exception) {
        CalendarEventExceptionEntity entity = calendarEventExceptionJpaRepository
                .findByCalendarEventIdAndOccurrenceStartAt(
                        exception.calendarEventId(),
                        exception.occurrenceStartAt()
                )
                .orElseGet(() -> CalendarEventExceptionEntity.from(exception));

        entity.update(exception);

        return calendarEventExceptionJpaRepository.save(entity).toDomain();
    }

    @Override
    public void deleteAllByCalendarEventId(Long calendarEventId) {
        calendarEventExceptionJpaRepository.deleteAllByCalendarEventId(calendarEventId);
    }
}
