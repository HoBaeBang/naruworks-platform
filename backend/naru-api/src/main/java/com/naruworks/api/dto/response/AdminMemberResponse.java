package com.naruworks.api.dto.response;

import com.naruworks.core.model.MemberAdministrationMember;
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
        AdminMemberReferrerResponse referrer,
        String referralCode,
        LocalDateTime createdAt,
        LocalDateTime approvedAt,
        LocalDateTime lastLoginAt
) {

    public static AdminMemberResponse from(MemberAdministrationMember administrationMember) {
        Member member = administrationMember.member();

        return new AdminMemberResponse(
                member.getId(),
                member.getEmail(),
                member.getDisplayName(),
                member.getProfileImageUrl(),
                member.getRole(),
                member.getStatus(),
                AdminMemberReferrerResponse.from(administrationMember.referrer()),
                member.getReferralCode().value(),
                member.getCreatedAt(),
                member.getApprovedAt(),
                member.getLastLoginAt()
        );
    }
}
