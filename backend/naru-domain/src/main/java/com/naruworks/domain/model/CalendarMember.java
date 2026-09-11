package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarMemberRole;
import java.time.LocalDateTime;

/** 캘린더와 회원의 참여 관계 및 캘린더 안의 권한 */
public record CalendarMember(
        Long id,
        Long calendarId,
        Long memberId,
        CalendarMemberRole role,
        LocalDateTime createdAt
) {
    public static CalendarMember owner(Long calendarId, Long memberId) {
        return new CalendarMember(null, calendarId, memberId, CalendarMemberRole.OWNER, null);
    }

    public static CalendarMember of(Long calendarId, Long memberId, CalendarMemberRole role) {
        return new CalendarMember(null, calendarId, memberId, role, null);
    }

    public boolean canEdit() {
        return role == CalendarMemberRole.OWNER || role == CalendarMemberRole.EDITOR;
    }
}
