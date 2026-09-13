package com.naruworks.core.service;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.core.port.CalendarEventWriter;
import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.CalendarWriter;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.model.CalendarMembership;
import com.naruworks.domain.type.CalendarMemberRole;
import com.naruworks.domain.type.CalendarType;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CalendarManagementService {

    private final CalendarReader calendarReader;
    private final CalendarWriter calendarWriter;
    private final CalendarMemberReader calendarMemberReader;
    private final CalendarMemberWriter calendarMemberWriter;
    private final CalendarEventWriter calendarEventWriter;

    /** 로그인 회원이 참여한 개인·공유 캘린더와 권한을 반환한다. */
    @Transactional
    public List<CalendarMembership> findCalendars(Long memberId) {
        ensureDefaultCalendar(memberId);
        return calendarMemberReader.findAllByMemberId(memberId).stream()
                .map(membership -> new CalendarMembership(
                        calendarReader.findById(membership.calendarId())
                                .orElseThrow(() -> new NotFoundException("캘린더를 찾을 수 없습니다.")),
                        membership.role()
                ))
                .toList();
    }

    private Calendar ensureDefaultCalendar(Long memberId) {
        return calendarReader.findDefaultByOwnerMemberId(memberId)
                .orElseGet(() -> {
                    Calendar calendar = calendarWriter.save(Calendar.personal(memberId));
                    calendarMemberWriter.save(CalendarMember.owner(calendar.getId(), memberId));
                    return calendar;
                });
    }

    /** 개인 또는 공유 캘린더를 만들고 생성자를 OWNER로 참여시킨다. */
    @Transactional
    public CalendarMembership createCalendar(Long ownerMemberId, String name, boolean shared, String displayColor) {
        Calendar calendar = calendarWriter.save(Calendar.create(
                ownerMemberId,
                name.trim(),
                shared ? com.naruworks.domain.type.CalendarType.SHARED : com.naruworks.domain.type.CalendarType.PERSONAL,
                displayColor
        ));
        calendarMemberWriter.save(CalendarMember.owner(calendar.getId(), ownerMemberId));
        return new CalendarMembership(calendar, CalendarMemberRole.OWNER);
    }

    /** OWNER가 캘린더 이름과 표시 색상을 변경한다. */
    @Transactional
    public CalendarMembership updateCalendar(Long memberId, Long calendarId, String name, String displayColor) {
        Calendar calendar = findOwnedCalendar(memberId, calendarId);
        Calendar updated = calendarWriter.save(calendar.withSettings(
                name.trim(), displayColor, calendar.isDefaultCalendar()
        ));
        return new CalendarMembership(updated, CalendarMemberRole.OWNER);
    }

    /** OWNER가 개인 캘린더 하나를 새 일정 작성의 기본 대상으로 지정한다. */
    @Transactional
    public void setDefaultCalendar(Long memberId, Long calendarId) {
        Calendar target = findOwnedCalendar(memberId, calendarId);
        if (target.getType() != CalendarType.PERSONAL) {
            throw new IllegalArgumentException("개인 캘린더만 기본 캘린더로 지정할 수 있습니다.");
        }
        if (target.isDefaultCalendar()) {
            return;
        }

        calendarReader.findDefaultByOwnerMemberId(memberId)
                .ifPresent(current -> calendarWriter.save(current.withSettings(
                        current.getName(), current.getDisplayColor(), false
                )));
        calendarWriter.save(target.withSettings(target.getName(), target.getDisplayColor(), true));
    }

    /** OWNER가 캘린더와 그 안의 모든 일정을 삭제한다. */
    @Transactional
    public void deleteCalendar(Long memberId, Long calendarId) {
        Calendar calendar = findOwnedCalendar(memberId, calendarId);

        List<Calendar> ownedPersonalCalendars = calendarReader.findAllByOwnerMemberId(memberId).stream()
                .filter(ownedCalendar -> ownedCalendar.getType() == CalendarType.PERSONAL)
                .toList();
        if (calendar.getType() == CalendarType.PERSONAL && ownedPersonalCalendars.size() < 2) {
            throw new IllegalStateException("개인 캘린더는 하나 이상 유지해야 합니다.");
        }

        if (calendar.isDefaultCalendar()) {
            Calendar replacement = ownedPersonalCalendars.stream()
                    .filter(ownedCalendar -> !ownedCalendar.getId().equals(calendarId))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("기본 캘린더를 변경할 수 없습니다."));
            calendarWriter.save(replacement.withSettings(
                    replacement.getName(), replacement.getDisplayColor(), true
            ));
        }

        calendarEventWriter.deleteAllByCalendarId(calendarId);
        calendarWriter.delete(calendarId);
    }

    private Calendar findOwnedCalendar(Long memberId, Long calendarId) {
        Calendar calendar = calendarReader.findById(calendarId)
                .orElseThrow(() -> new NotFoundException("캘린더를 찾을 수 없습니다."));
        if (!calendar.getOwnerMemberId().equals(memberId)) {
            throw new AuthorizationException("캘린더를 관리할 권한이 없습니다.");
        }
        return calendar;
    }

}
