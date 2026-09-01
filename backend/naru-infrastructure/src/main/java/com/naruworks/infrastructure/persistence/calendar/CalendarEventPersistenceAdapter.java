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

    @Override
    public CalendarEvent save(CalendarEvent event) {
        CalendarEventEntity savedEntity = calendarEventJpaRepository.save(CalendarEventEntity.from(event));

        return savedEntity.toDomain();
    }

    @Override
    public List<CalendarEvent> findEvents(
            Long memberId,
            LocalDateTime from,
            LocalDateTime to
    ) {
        return calendarEventJpaRepository
                .findAllByMemberIdAndStartAtLessThanAndEndAtGreaterThanOrderByStartAtAsc(
                        memberId,
                        to,
                        from
                )
                .stream()
                .map(CalendarEventEntity::toDomain)
                .toList();
    }

    @Override
    public CalendarEvent findEvent(Long memberId, Long id) {
        return getOwnedEvent(memberId, id).toDomain();
    }

    @Override
    public CalendarEvent update(Long memberId, CalendarEvent event) {
        CalendarEventEntity entity = getOwnedEvent(memberId, event.getId());

        entity.update(event);

        return calendarEventJpaRepository.save(entity).toDomain();
    }

    @Override
    public void delete(Long memberId, Long id) {
        CalendarEventEntity entity = getOwnedEvent(memberId, id);

        calendarEventJpaRepository.delete(entity);
    }

    private CalendarEventEntity getOwnedEvent(Long memberId, Long id) {
        return calendarEventJpaRepository.findByIdAndMemberId(id, memberId)
                .orElseThrow(() -> new NotFoundException("일정을 찾을 수 없습니다."));
    }
}
