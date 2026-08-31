package com.naruworks.api.dto.response;

import com.naruworks.domain.model.Member;

public record MemberRegistrationResponse(
        Long memberId,
        String role
) {
    public static MemberRegistrationResponse from(Member member) {
        return new MemberRegistrationResponse(
                member.getId(),
                member.getRole().name()
        );
    }
}
