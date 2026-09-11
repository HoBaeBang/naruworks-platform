package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarMemberRole;

/** 로그인한 회원 관점에서 조회한 캘린더와 해당 권한 */
public record CalendarMembership(Calendar calendar, CalendarMemberRole role) {
}
