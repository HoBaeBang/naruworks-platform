package com.naruworks.api.dto.response;

import com.naruworks.domain.model.Member;

public record AdminMemberReferrerResponse(
        Long id,
        String displayName,
        String email
) {

    public static AdminMemberReferrerResponse from(Member member) {
        if (member == null) {
            return null;
        }

        return new AdminMemberReferrerResponse(
                member.getId(),
                member.getDisplayName(),
                member.getEmail()
        );
    }
}
