package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.domain.model.CalendarMember;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class CalendarMemberPersistenceAdapter implements CalendarMemberReader, CalendarMemberWriter {

    private final CalendarMemberJpaRepository calendarMemberJpaRepository;

    @Override
    public List<CalendarMember> findAllByMemberId(Long memberId) {
        return calendarMemberJpaRepository.findAllByMemberId(memberId).stream()
                .map(CalendarMemberEntity::toDomain)
                .toList();
    }

    @Override
    public List<CalendarMember> findAllByCalendarId(Long calendarId) {
        return calendarMemberJpaRepository.findAllByCalendarId(calendarId).stream()
                .map(CalendarMemberEntity::toDomain)
                .toList();
    }

    @Override
    public Optional<CalendarMember> findByCalendarIdAndMemberId(Long calendarId, Long memberId) {
        return calendarMemberJpaRepository.findByCalendarIdAndMemberId(calendarId, memberId)
                .map(CalendarMemberEntity::toDomain);
    }

    @Override
    public CalendarMember save(CalendarMember calendarMember) {
        return calendarMemberJpaRepository.save(CalendarMemberEntity.from(calendarMember)).toDomain();
    }

    @Override
    public void deleteByCalendarIdAndMemberId(Long calendarId, Long memberId) {
        calendarMemberJpaRepository.deleteByCalendarIdAndMemberId(calendarId, memberId);
    }
}
