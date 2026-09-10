package com.naruworks.core.model;

/** Google Calendar 연결 계정 식별 정보 */
public record GoogleCalendarAccount(
        String providerAccountId,
        String email
) {
}
