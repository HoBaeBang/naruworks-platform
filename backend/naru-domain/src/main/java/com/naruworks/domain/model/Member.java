package com.naruworks.domain.model;

import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import java.time.LocalDateTime;

import com.naruworks.domain.value.ReferralCode;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder(toBuilder = true)
public class Member {

    private final Long id;
    private final String email;
    private final String displayName;
    private final String profileImageUrl;
    private final AuthProvider provider;
    private final String providerUserId;
    private final MemberRole role;
    private final MemberStatus status;
    private final Long referrerMemberId;
    private final ReferralCode referralCode;
    private final LocalDateTime createdAt;
    private final LocalDateTime approvedAt;
    private final LocalDateTime lastLoginAt;

    public static Member createApprovedInvitedGoogleMember(
            String email,
            String displayName,
            String profileImageUrl,
            String providerUserId,
            Long referrerMemberId,
            ReferralCode referralCode,
            LocalDateTime now
    ) {
        return Member.builder()
                .email(email)
                .displayName(displayName)
                .profileImageUrl(profileImageUrl)
                .provider(AuthProvider.GOOGLE)
                .providerUserId(providerUserId)
                .role(MemberRole.USER)
                .status(MemberStatus.APPROVED)
                .referrerMemberId(referrerMemberId)
                .referralCode(referralCode)
                .createdAt(now)
                .approvedAt(now)
                .lastLoginAt(now)
                .build();
    }

    public static Member createApprovedInitialAdminGoogleMember(
            String email,
            String displayName,
            String profileImageUrl,
            String providerUserId,
            ReferralCode referralCode,
            LocalDateTime now
    ) {
        return Member.builder()
                .email(email)
                .displayName(displayName)
                .profileImageUrl(profileImageUrl)
                .provider(AuthProvider.GOOGLE)
                .providerUserId(providerUserId)
                .role(MemberRole.ADMIN)
                .status(MemberStatus.APPROVED)
                .referrerMemberId(null)
                .referralCode(referralCode)
                .createdAt(now)
                .approvedAt(now)
                .lastLoginAt(now)
                .build();
    }

    public Member updateLastLoginAt(LocalDateTime now) {
        return toBuilder()
                .lastLoginAt(now)
                .build();
    }
}
