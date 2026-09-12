package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.CalendarWriter;
import com.naruworks.domain.model.Calendar;
import java.util.Optional;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class CalendarPersistenceAdapter implements CalendarReader, CalendarWriter {

    private final CalendarJpaRepository calendarJpaRepository;

    @Override
    public Optional<Calendar> findDefaultByOwnerMemberId(Long memberId) {
        return calendarJpaRepository.findByOwnerMemberIdAndDefaultCalendarTrue(memberId)
                .map(CalendarEntity::toDomain);
    }

    @Override
    public Optional<Calendar> findById(Long calendarId) {
        return calendarJpaRepository.findById(calendarId).map(CalendarEntity::toDomain);
    }

    @Override
    public List<Calendar> findAllByOwnerMemberId(Long memberId) {
        return calendarJpaRepository.findAllByOwnerMemberId(memberId).stream()
                .map(CalendarEntity::toDomain)
                .toList();
    }

    @Override
    public Calendar save(Calendar calendar) {
        return calendarJpaRepository.save(CalendarEntity.from(calendar)).toDomain();
    }

    @Override
    public void delete(Long calendarId) {
        calendarJpaRepository.deleteById(calendarId);
    }
}
