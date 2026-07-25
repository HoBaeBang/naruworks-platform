package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarEventReader;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.domain.model.CalendarEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import com.naruworks.core.exception.NotFoundException;

import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class CalendarEventPersistenceAdapter implements CalendarEventReader, CalendarEventWriter {

    private final CalendarEventJpaRepository calendarEventJpaRepository;

    public List<CalendarEvent> findEvents(LocalDateTime from, LocalDateTime to) {
        return calendarEventJpaRepository
                .findAllByStartAtLessThanAndEndAtGreaterThanOrderByStartAtAsc(to, from)
                .stream()
                .map(CalendarEventEntity::toDomain)
                .toList();
    }

    @Override
    public CalendarEvent save(CalendarEvent event) {
        CalendarEventEntity savedEntity = calendarEventJpaRepository.save(CalendarEventEntity.from(event));

        return savedEntity.toDomain();
    }

    @Override
    public CalendarEvent findEvent(Long id) {
        return calendarEventJpaRepository.findById(id)
                .map(CalendarEventEntity::toDomain)
                .orElseThrow(() -> new NotFoundException("일정을 찾을 수 없습니다."));
    }

    @Override
    public CalendarEvent update(CalendarEvent event) {
        CalendarEventEntity entity = calendarEventJpaRepository.findById(event.id())
                .orElseThrow(() -> new NotFoundException("일정을 찾을 수 없습니다."));

        entity.update(event);

        return calendarEventJpaRepository.save(entity).toDomain();
    }

    @Override
    public void delete(Long id) {
        CalendarEventEntity entity = calendarEventJpaRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("일정을 찾을 수 없습니다."));

        calendarEventJpaRepository.delete(entity);
    }
}
