package com.naruworks.api.dto.response;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;

import java.time.LocalDateTime;

public record AdminMemberResponse(
        Long id,
        String email,
        String displayName,
        String profileImageUrl,
        MemberRole role,
        MemberStatus status,
        Long referrerMemberId,
        String referralCode,
        LocalDateTime createdAt,
        LocalDateTime approvedAt,
        LocalDateTime lastLoginAt
) {

    public static AdminMemberResponse from(Member member) {
        return new AdminMemberResponse(
                member.getId(),
                member.getEmail(),
                member.getDisplayName(),
                member.getProfileImageUrl(),
                member.getRole(),
                member.getStatus(),
                member.getReferrerMemberId(),
                member.getReferralCode().value(),
                member.getCreatedAt(),
                member.getApprovedAt(),
                member.getLastLoginAt()
        );
    }
}
