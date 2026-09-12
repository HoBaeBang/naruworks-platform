package com.naruworks.api.dto.response;

import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarMemberRole;

public record CalendarMemberResponse(Long memberId, String displayName, String email, CalendarMemberRole role) {
    public static CalendarMemberResponse from(CalendarMember membership, Member member) {
        return new CalendarMemberResponse(member.getId(), member.getDisplayName(), member.getEmail(), membership.role());
    }
}
