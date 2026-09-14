package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

/** 회원과 외부 캘린더 계정 사이의 읽기 전용 연결 정보 */
@Getter
@Builder(toBuilder = true)
public class CalendarIntegration {

    private final Long id;
    private final Long memberId;
    private final CalendarIntegrationProvider provider;
    private final String providerAccountId;
    private final String providerEmail;
    private final String encryptedRefreshToken;
    private final CalendarIntegrationStatus status;
    private final LocalDateTime lastSyncAttemptedAt;
    private final LocalDateTime lastSyncedAt;
    private final String lastSyncError;
    private final LocalDateTime createdAt;
    private final LocalDateTime updatedAt;

    public static CalendarIntegration connectGoogle(
            Long memberId,
            String providerAccountId,
            String providerEmail,
            String encryptedRefreshToken,
            LocalDateTime now
    ) {
        return CalendarIntegration.builder()
                .memberId(memberId)
                .provider(CalendarIntegrationProvider.GOOGLE)
                .providerAccountId(providerAccountId)
                .providerEmail(providerEmail)
                .encryptedRefreshToken(encryptedRefreshToken)
                .status(CalendarIntegrationStatus.CONNECTED)
                .createdAt(now)
                .updatedAt(now)
                .build();
    }

    public CalendarIntegration reconnect(
            String providerAccountId,
            String providerEmail,
            String encryptedRefreshToken,
            LocalDateTime now
    ) {
        return toBuilder()
                .providerAccountId(providerAccountId)
                .providerEmail(providerEmail)
                .encryptedRefreshToken(encryptedRefreshToken)
                .status(CalendarIntegrationStatus.CONNECTED)
                .updatedAt(now)
                .build();
    }

    /** 외부 API 동기화가 성공하면 최신 성공 시각을 남기고 이전 오류를 지운다. */
    public CalendarIntegration synchronizedSuccessfully(LocalDateTime now) {
        return toBuilder()
                .lastSyncAttemptedAt(now)
                .lastSyncedAt(now)
                .lastSyncError(null)
                .updatedAt(now)
                .build();
    }

    /** 연결 자체는 유지하되, 다음 주기 또는 수동 요청에서 다시 시도할 수 있게 오류를 남긴다. */
    public CalendarIntegration synchronizationFailed(LocalDateTime now, String errorMessage) {
        return toBuilder()
                .lastSyncAttemptedAt(now)
                .lastSyncError(errorMessage)
                .updatedAt(now)
                .build();
    }

    /** 연결 해제 후에는 refresh token을 보관하지 않는다. */
    public CalendarIntegration disconnect(LocalDateTime now) {
        return toBuilder()
                .encryptedRefreshToken(null)
                .status(CalendarIntegrationStatus.REVOKED)
                .lastSyncAttemptedAt(null)
                .lastSyncedAt(null)
                .lastSyncError(null)
                .updatedAt(now)
                .build();
    }
}
