package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(
        name = "calendar_integrations",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_calendar_integrations_member_provider",
                columnNames = {"member_id", "provider"}
        )
)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarIntegrationEntity {

    /** 외부 캘린더 연결 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 연결을 소유한 회원 내부 식별자 */
    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** 외부 캘린더 제공자 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CalendarIntegrationProvider provider;

    /** 제공자 기준 연결 계정 식별자 */
    @Column(name = "provider_account_id", nullable = false, length = 255)
    private String providerAccountId;

    /** 제공자 계정 이메일 */
    @Column(name = "provider_email", nullable = false, length = 320)
    private String providerEmail;

    /** AES-GCM으로 암호화한 제공자 refresh token */
    @Column(name = "encrypted_refresh_token", nullable = false, columnDefinition = "TEXT")
    private String encryptedRefreshToken;

    /** 사용자가 선택한 제공자 캘린더 식별자 */
    @Column(name = "selected_calendar_id", length = 500)
    private String selectedCalendarId;

    /** 현재 연결 상태 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CalendarIntegrationStatus status;

    /** 마지막으로 외부 일정을 동기화한 시각 */
    @Column(name = "last_synced_at")
    private LocalDateTime lastSyncedAt;

    /** Google 증분 동기화에 사용할 다음 sync token */
    @Column(name = "sync_token", columnDefinition = "TEXT")
    private String syncToken;

    /** 연결 생성 시각 */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** 연결 정보 마지막 수정 시각 */
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static CalendarIntegrationEntity from(CalendarIntegration integration) {
        CalendarIntegrationEntity entity = new CalendarIntegrationEntity();
        entity.id = integration.getId();
        entity.memberId = integration.getMemberId();
        entity.provider = integration.getProvider();
        entity.providerAccountId = integration.getProviderAccountId();
        entity.providerEmail = integration.getProviderEmail();
        entity.encryptedRefreshToken = integration.getEncryptedRefreshToken();
        entity.selectedCalendarId = integration.getSelectedCalendarId();
        entity.status = integration.getStatus();
        entity.lastSyncedAt = integration.getLastSyncedAt();
        entity.syncToken = integration.getSyncToken();
        entity.createdAt = integration.getCreatedAt();
        entity.updatedAt = integration.getUpdatedAt();
        return entity;
    }

    public CalendarIntegration toDomain() {
        return CalendarIntegration.builder()
                .id(id)
                .memberId(memberId)
                .provider(provider)
                .providerAccountId(providerAccountId)
                .providerEmail(providerEmail)
                .encryptedRefreshToken(encryptedRefreshToken)
                .selectedCalendarId(selectedCalendarId)
                .status(status)
                .lastSyncedAt(lastSyncedAt)
                .syncToken(syncToken)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }
}
