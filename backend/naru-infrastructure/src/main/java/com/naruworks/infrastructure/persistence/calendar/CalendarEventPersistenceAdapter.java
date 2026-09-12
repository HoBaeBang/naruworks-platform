package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import com.naruworks.core.exception.NotFoundException;

import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class CalendarEventPersistenceAdapter implements CalendarEventReader, CalendarEventWriter {

    private final CalendarEventJpaRepository calendarEventJpaRepository;

    @Override
    public CalendarEvent save(CalendarEvent event) {
        CalendarEventEntity savedEntity = calendarEventJpaRepository.save(CalendarEventEntity.from(event));

        return savedEntity.toDomain();
    }

    @Override
    public List<CalendarEvent> findEvents(
            List<Long> calendarIds,
            LocalDateTime from,
            LocalDateTime to
    ) {
        return calendarEventJpaRepository
                .findDisplayCandidates(
                        calendarIds,
                        from,
                        to,
                        CalendarEventRecurrenceRule.NONE,
                        CalendarEventStatus.ACTIVE
                )
                .stream()
                .map(CalendarEventEntity::toDomain)
                .toList();
    }

    @Override
    public CalendarEvent findEvent(Long id) {
        return getEvent(id).toDomain();
    }

    @Override
    public CalendarEvent update(CalendarEvent event) {
        CalendarEventEntity entity = getEvent(event.getId());

        entity.update(event);

        return calendarEventJpaRepository.save(entity).toDomain();
    }

    @Override
    public void delete(Long id) {
        CalendarEventEntity entity = getEvent(id);

        calendarEventJpaRepository.delete(entity);
    }

    @Override
    public void deleteAllByCalendarId(Long calendarId) {
        calendarEventJpaRepository.deleteAllByCalendarId(calendarId);
    }

    private CalendarEventEntity getEvent(Long id) {
        return calendarEventJpaRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("일정을 찾을 수 없습니다."));
    }
}
