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
    private final String selectedCalendarId;
    private final CalendarIntegrationStatus status;
    private final LocalDateTime lastSyncedAt;
    private final String syncToken;
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
}
