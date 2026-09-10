package com.naruworks.infrastructure.calendar;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Google Calendar 전용 OAuth 클라이언트 설정값 */
@Component
public class GoogleCalendarOAuthProperties {

    @Value("${naru.google-calendar.client-id:}")
    private String clientId;

    @Value("${naru.google-calendar.client-secret:}")
    private String clientSecret;

    @Value("${naru.google-calendar.redirect-uri:}")
    private String redirectUri;

    @Value("${naru.google-calendar.token-encryption-key:}")
    private String tokenEncryptionKey;

    public String getClientId() {
        return clientId;
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public String getRedirectUri() {
        return redirectUri;
    }

    public String getTokenEncryptionKey() {
        return tokenEncryptionKey;
    }
}
