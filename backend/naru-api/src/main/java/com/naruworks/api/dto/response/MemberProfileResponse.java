package com.naruworks.api.dto.response;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;

public record MemberProfileResponse(
        Long id,
        String email,
        String displayName,
        String profileImageUrl,
        MemberRole role,
        MemberStatus status,
        String referralCode
) {

    public static MemberProfileResponse from(Member member) {
        return new MemberProfileResponse(
                member.getId(),
                member.getEmail(),
                member.getDisplayName(),
                member.getProfileImageUrl(),
                member.getRole(),
                member.getStatus(),
                member.getReferralCode().value()
        );
    }
}
