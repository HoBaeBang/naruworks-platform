package com.naruworks.core.model;

/** Google 인가 코드 교환으로 받은 access token과 refresh token */
public record GoogleCalendarOAuthToken(
        String accessToken,
        String refreshToken
) {
}
