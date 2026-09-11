package com.naruworks.core.service;

import com.naruworks.core.exception.AuthorizationException;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.port.CalendarMemberReader;
import com.naruworks.core.port.CalendarMemberWriter;
import com.naruworks.core.port.CalendarReader;
import com.naruworks.core.port.CalendarWriter;
import com.naruworks.core.port.MemberReader;
import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.model.CalendarMembership;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarMemberRole;
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
    private final MemberReader memberReader;

    /** 로그인 회원이 참여한 개인·공유 캘린더와 권한을 반환한다. */
    @Transactional
    public List<CalendarMembership> findCalendars(Long memberId) {
        ensurePersonalCalendar(memberId);
        return calendarMemberReader.findAllByMemberId(memberId).stream()
                .map(membership -> new CalendarMembership(
                        calendarReader.findById(membership.calendarId())
                                .orElseThrow(() -> new NotFoundException("캘린더를 찾을 수 없습니다.")),
                        membership.role()
                ))
                .toList();
    }

    private Calendar ensurePersonalCalendar(Long memberId) {
        return calendarReader.findPersonalByOwnerMemberId(memberId)
                .orElseGet(() -> {
                    Calendar calendar = calendarWriter.save(Calendar.personal(memberId));
                    calendarMemberWriter.save(CalendarMember.owner(calendar.getId(), memberId));
                    return calendar;
                });
    }

    /** 공유 캘린더를 만들고 생성자를 OWNER로 참여시킨다. */
    @Transactional
    public CalendarMembership createSharedCalendar(Long ownerMemberId, String name) {
        Calendar calendar = calendarWriter.save(Calendar.shared(ownerMemberId, name.trim()));
        calendarMemberWriter.save(CalendarMember.owner(calendar.getId(), ownerMemberId));
        return new CalendarMembership(calendar, CalendarMemberRole.OWNER);
    }

    /** OWNER만 승인된 기존 회원을 EDITOR 또는 VIEWER로 초대할 수 있다. */
    @Transactional
    public CalendarMembership addMember(
            Long requesterMemberId,
            Long calendarId,
            String memberEmail,
            CalendarMemberRole role
    ) {
        if (role == CalendarMemberRole.OWNER) {
            throw new IllegalArgumentException("OWNER 권한은 캘린더 생성자에게만 부여할 수 있습니다.");
        }

        Calendar calendar = calendarReader.findById(calendarId)
                .orElseThrow(() -> new NotFoundException("캘린더를 찾을 수 없습니다."));
        CalendarMember requester = calendarMemberReader
                .findByCalendarIdAndMemberId(calendarId, requesterMemberId)
                .orElseThrow(() -> new AuthorizationException("공유 캘린더 관리 권한이 없습니다."));
        if (requester.role() != CalendarMemberRole.OWNER) {
            throw new AuthorizationException("공유 캘린더 관리 권한이 없습니다.");
        }

        Member member = memberReader.findApprovedByEmail(memberEmail)
                .orElseThrow(() -> new NotFoundException("승인된 회원을 찾을 수 없습니다."));
        if (calendarMemberReader.findByCalendarIdAndMemberId(calendarId, member.getId()).isPresent()) {
            throw new IllegalArgumentException("이미 참여 중인 회원입니다.");
        }

        calendarMemberWriter.save(CalendarMember.of(calendarId, member.getId(), role));
        return new CalendarMembership(calendar, role);
    }
}
