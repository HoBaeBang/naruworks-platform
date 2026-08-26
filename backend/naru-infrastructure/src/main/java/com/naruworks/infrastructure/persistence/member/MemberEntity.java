package com.naruworks.infrastructure.persistence.member;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.type.MemberRole;
import com.naruworks.domain.type.MemberStatus;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(
        name = "members",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_members_provider_user",
                        columnNames = {"provider", "provider_user_id"}
                )
        }
)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MemberEntity {

    /** 회원 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Google 계정 이메일 */
    @Column(nullable = false)
    private String email;

    /** Google 계정 표시 이름 */
    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    /** Google 계정 프로필 이미지 URL */
    @Column(name = "profile_image_url", length = 500)
    private String profileImageUrl;

    /** OAuth 인증 제공자 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private AuthProvider provider;

    /** OAuth 제공자 기준 사용자 식별자 */
    @Column(name = "provider_user_id", nullable = false)
    private String providerUserId;

    /** 회원 권한 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private MemberRole role;

    /** 회원 승인 상태 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private MemberStatus status;

    /** 가입 요청자가 입력한 추천인명 */
    @Column(name = "referrer_name", length = 100)
    private String referrerName;

    /** 회원 생성 시각 */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** 회원 승인 시각 */
    @Column(name = "approved_at")
    private LocalDateTime approvedAt;

    /** 마지막 로그인 시각 */
    @Column(name = "last_login_at", nullable = false)
    private LocalDateTime lastLoginAt;

    public static MemberEntity from(Member member) {
        MemberEntity entity = new MemberEntity();
        entity.id = member.getId();
        entity.email = member.getEmail();
        entity.displayName = member.getDisplayName();
        entity.profileImageUrl = member.getProfileImageUrl();
        entity.provider = member.getProvider();
        entity.providerUserId = member.getProviderUserId();
        entity.role = member.getRole();
        entity.status = member.getStatus();
        entity.referrerName = member.getReferrerName();
        entity.createdAt = member.getCreatedAt();
        entity.approvedAt = member.getApprovedAt();
        entity.lastLoginAt = member.getLastLoginAt();

        return entity;
    }

    public Member toDomain() {
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
                .lastLoginAt(lastLoginAt)
                .build();
    }
}
