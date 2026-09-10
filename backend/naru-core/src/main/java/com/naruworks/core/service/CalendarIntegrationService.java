package com.naruworks.core.service;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import com.naruworks.core.port.SensitiveDataEncryptor;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CalendarIntegrationService {

    private final CalendarIntegrationReader calendarIntegrationReader;
    private final CalendarIntegrationWriter calendarIntegrationWriter;
    private final GoogleCalendarOAuthClient googleCalendarOAuthClient;
    private final SensitiveDataEncryptor sensitiveDataEncryptor;
    private final Clock clock;

    @Transactional(readOnly = true)
    public String createGoogleAuthorizationUrl(String state) {
        return googleCalendarOAuthClient.createAuthorizationUrl(state);
    }

    /** Google 인가 코드 교환 결과를 암호화해 회원별 연결 정보로 저장한다. */
    @Transactional
    public CalendarIntegration connectGoogleCalendar(Long memberId, String authorizationCode) {
        GoogleCalendarOAuthToken token = googleCalendarOAuthClient
                .exchangeAuthorizationCode(authorizationCode);
        validateRefreshToken(token);

        GoogleCalendarAccount account = googleCalendarOAuthClient.findAccount(token.accessToken());
        String encryptedRefreshToken = sensitiveDataEncryptor.encrypt(token.refreshToken());
        LocalDateTime now = LocalDateTime.now(clock);

        CalendarIntegration integration = calendarIntegrationReader
                .findByMemberIdAndProvider(memberId, CalendarIntegrationProvider.GOOGLE)
                .map(existing -> existing.reconnect(
                        account.providerAccountId(),
                        account.email(),
                        encryptedRefreshToken,
                        now
                ))
                .orElseGet(() -> CalendarIntegration.connectGoogle(
                        memberId,
                        account.providerAccountId(),
                        account.email(),
                        encryptedRefreshToken,
                        now
                ));

        return calendarIntegrationWriter.save(integration);
    }

    @Transactional(readOnly = true)
    public Optional<CalendarIntegration> findGoogleIntegration(Long memberId) {
        return calendarIntegrationReader.findByMemberIdAndProvider(
                memberId,
                CalendarIntegrationProvider.GOOGLE
        );
    }

    private void validateRefreshToken(GoogleCalendarOAuthToken token) {
        if (token.refreshToken() == null || token.refreshToken().isBlank()) {
            throw new IllegalStateException(
                    "Google Calendar 연결에 필요한 refresh token을 받지 못했습니다. 다시 연결해주세요."
            );
        }
    }
}
