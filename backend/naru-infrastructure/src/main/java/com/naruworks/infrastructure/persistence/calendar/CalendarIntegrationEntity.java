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
    @Column(name = "encrypted_refresh_token", columnDefinition = "TEXT")
    private String encryptedRefreshToken;

    /** 현재 연결 상태 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CalendarIntegrationStatus status;

    /** 최근 Google 동기화를 시도한 시각 */
    @Column(name = "last_sync_attempted_at")
    private LocalDateTime lastSyncAttemptedAt;

    /** 최근 Google 동기화에 성공한 시각 */
    @Column(name = "last_synced_at")
    private LocalDateTime lastSyncedAt;

    /** 최근 Google 동기화 실패 원인 */
    @Column(name = "last_sync_error", columnDefinition = "TEXT")
    private String lastSyncError;

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
        entity.status = integration.getStatus();
        entity.lastSyncAttemptedAt = integration.getLastSyncAttemptedAt();
        entity.lastSyncedAt = integration.getLastSyncedAt();
        entity.lastSyncError = integration.getLastSyncError();
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
                .status(status)
                .lastSyncAttemptedAt(lastSyncAttemptedAt)
                .lastSyncedAt(lastSyncedAt)
                .lastSyncError(lastSyncError)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }
}
