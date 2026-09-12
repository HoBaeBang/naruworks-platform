package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarInvitationLink;
import com.naruworks.domain.type.CalendarMemberRole;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "calendar_invitation_links")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarInvitationLinkEntity {

    /** 초대 링크 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 링크로 참여할 공유 캘린더 식별자 */
    @Column(name = "calendar_id", nullable = false)
    private Long calendarId;

    /** 초대 링크를 발급한 OWNER 회원 식별자 */
    @Column(name = "created_by_member_id", nullable = false)
    private Long createdByMemberId;

    /** 원문을 보관하지 않는 SHA-256 초대 토큰 해시 */
    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** 링크 수락 회원에게 부여할 캘린더 권한 */
    @Enumerated(EnumType.STRING)
    @Column(name = "member_role", nullable = false, length = 30)
    private CalendarMemberRole role;

    /** 링크가 더 이상 수락될 수 없는 만료 시각 */
    @Column(nullable = false)
    private LocalDateTime expiresAt;

    /** OWNER가 수동으로 링크를 폐기한 시각 */
    private LocalDateTime revokedAt;

    /** 링크 발급 시각 */
    @Column(nullable = false)
    private LocalDateTime createdAt;

    static CalendarInvitationLinkEntity from(CalendarInvitationLink link) {
        CalendarInvitationLinkEntity entity = new CalendarInvitationLinkEntity();
        entity.id = link.getId();
        entity.calendarId = link.getCalendarId();
        entity.createdByMemberId = link.getCreatedByMemberId();
        entity.tokenHash = link.getTokenHash();
        entity.role = link.getRole();
        entity.expiresAt = link.getExpiresAt();
        entity.revokedAt = link.getRevokedAt();
        entity.createdAt = link.getCreatedAt();
        return entity;
    }

    void revoke(LocalDateTime now) {
        revokedAt = now;
    }

    CalendarInvitationLink toDomain() {
        return CalendarInvitationLink.builder()
                .id(id).calendarId(calendarId).createdByMemberId(createdByMemberId)
                .tokenHash(tokenHash).role(role).expiresAt(expiresAt)
                .revokedAt(revokedAt).createdAt(createdAt).build();
    }
}
