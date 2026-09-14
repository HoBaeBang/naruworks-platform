package com.naruworks.core.port;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendar;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import com.naruworks.core.model.GoogleCalendarEvent;
import com.naruworks.core.model.GoogleCalendarSyncResult;
import java.time.LocalDateTime;
import java.util.List;

public interface GoogleCalendarOAuthClient {

    String createAuthorizationUrl(String state);

    GoogleCalendarOAuthToken exchangeAuthorizationCode(String authorizationCode);

    GoogleCalendarAccount findAccount(String accessToken);

    String refreshAccessToken(String refreshToken);

    /** Google OAuth 권한 철회를 요청한다. 로컬 연결 정리는 이 요청의 성공 여부와 무관하게 진행한다. */
    void revokeRefreshToken(String refreshToken);

    List<GoogleCalendar> findCalendars(String accessToken);

    List<GoogleCalendarEvent> findEvents(
            String accessToken,
            String calendarId,
            LocalDateTime from,
            LocalDateTime to
    );

    /** syncToken이 없으면 최초 전체 동기화, 있으면 이후 변경분만 조회한다. */
    GoogleCalendarSyncResult synchronizeEvents(
            String accessToken,
            String calendarId,
            String syncToken
    );
}
