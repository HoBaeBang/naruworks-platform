package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.CalendarWriter;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.type.CalendarType;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class CalendarPersistenceAdapter implements CalendarReader, CalendarWriter {

    private final CalendarJpaRepository calendarJpaRepository;

    @Override
    public Optional<Calendar> findPersonalByOwnerMemberId(Long memberId) {
        return calendarJpaRepository.findByOwnerMemberIdAndType(memberId, CalendarType.PERSONAL)
                .map(CalendarEntity::toDomain);
    }

    @Override
    public Optional<Calendar> findById(Long calendarId) {
        return calendarJpaRepository.findById(calendarId).map(CalendarEntity::toDomain);
    }

    @Override
    public Calendar save(Calendar calendar) {
        return calendarJpaRepository.save(CalendarEntity.from(calendar)).toDomain();
    }
}
