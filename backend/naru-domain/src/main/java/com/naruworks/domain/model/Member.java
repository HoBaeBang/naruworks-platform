package com.naruworks.domain.model;

import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Member {

    private final Long id;
    private final String email;
    private final String displayName;
    private final String profileImageUrl;
    private final AuthProvider provider;
    private final String providerUserId;
    private final MemberRole role;
    private final MemberStatus status;
    private final String referrerName;
    private final LocalDateTime createdAt;
    private final LocalDateTime approvedAt;
    private final LocalDateTime lastLoginAt;

    public static Member createPendingGoogleMember(
            String email,
            String displayName,
            String profileImageUrl,
            String providerUserId,
            LocalDateTime now
    ) {
        return Member.builder()
                .email(email)
                .displayName(displayName)
                .profileImageUrl(profileImageUrl)
                .provider(AuthProvider.GOOGLE)
                .providerUserId(providerUserId)
                .role(MemberRole.USER)
                .status(MemberStatus.PENDING)
                .createdAt(now)
                .lastLoginAt(now)
                .build();
    }

    public Member updateLastLoginAt(LocalDateTime now) {
        return Member.builder()
                .id(id)
                .email(email)
                .displayName(displayName)
                .profileImageUrl(profileImageUrl)
                .provider(provider)
                .providerUserId(providerUserId)
                .role(role)
                .status(status)
                .referrerName(referrerName)
                .createdAt(createdAt)
                .approvedAt(approvedAt)
                .lastLoginAt(now)
                .build();
    }
}
