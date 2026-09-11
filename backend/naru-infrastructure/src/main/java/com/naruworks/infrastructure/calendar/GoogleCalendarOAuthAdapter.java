package com.naruworks.infrastructure.calendar;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.naruworks.core.model.GoogleCalendar;
import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import com.naruworks.core.model.GoogleCalendarEvent;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

@Component
@RequiredArgsConstructor
public class GoogleCalendarOAuthAdapter implements GoogleCalendarOAuthClient {

    private static final String AUTHORIZATION_URI = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URI = "https://oauth2.googleapis.com/token";
    private static final String USER_INFO_URI = "https://openidconnect.googleapis.com/v1/userinfo";
    private static final String CALENDAR_LIST_URI =
            "https://www.googleapis.com/calendar/v3/users/me/calendarList";
    private static final String EVENTS_URI = "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events";
    private static final ZoneId KOREA_TIME_ZONE = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter GOOGLE_DATE_TIME_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");
    private static final List<String> SCOPES = List.of(
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
            "https://www.googleapis.com/auth/calendar.events.readonly"
    );

    private final GoogleCalendarOAuthProperties properties;
    private final RestClient restClient = RestClient.create();

    @Override
    public String createAuthorizationUrl(String state) {
        validateConfiguration();

        return UriComponentsBuilder.fromUriString(AUTHORIZATION_URI)
                .queryParam("client_id", properties.getClientId())
                .queryParam("redirect_uri", properties.getRedirectUri())
                .queryParam("response_type", "code")
                .queryParam("scope", String.join(" ", SCOPES))
                .queryParam("access_type", "offline")
                // 다중 연결에서는 현재 Google 로그인 계정을 자동 재사용하지 않도록 계정 선택을 요청한다.
                .queryParam("prompt", "consent select_account")
                .queryParam("state", state)
                .encode()
                .toUriString();
    }

    @Override
    public GoogleCalendarOAuthToken exchangeAuthorizationCode(String authorizationCode) {
        validateConfiguration();

        LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("code", authorizationCode);
        form.add("client_id", properties.getClientId());
        form.add("client_secret", properties.getClientSecret());
        form.add("redirect_uri", properties.getRedirectUri());
        form.add("grant_type", "authorization_code");

        GoogleTokenResponse response = restClient.post()
                .uri(TOKEN_URI)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve()
                .body(GoogleTokenResponse.class);

        if (response == null || response.accessToken() == null) {
            throw new IllegalStateException("Google OAuth 토큰 교환에 실패했습니다.");
        }
        return new GoogleCalendarOAuthToken(response.accessToken(), response.refreshToken());
    }

    @Override
    public GoogleCalendarAccount findAccount(String accessToken) {
        GoogleUserInfoResponse response = restClient.get()
                .uri(USER_INFO_URI)
                .headers(headers -> headers.setBearerAuth(accessToken))
                .retrieve()
                .body(GoogleUserInfoResponse.class);

        if (response == null || response.subject() == null || response.email() == null) {
            throw new IllegalStateException("Google 계정 정보를 읽지 못했습니다.");
        }
        return new GoogleCalendarAccount(response.subject(), response.email());
    }

    @Override
    public String refreshAccessToken(String refreshToken) {
        validateConfiguration();

        LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", properties.getClientId());
        form.add("client_secret", properties.getClientSecret());
        form.add("refresh_token", refreshToken);
        form.add("grant_type", "refresh_token");

        GoogleTokenRefreshResponse response = restClient.post()
                .uri(TOKEN_URI)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve()
                .body(GoogleTokenRefreshResponse.class);

        if (response == null || response.accessToken() == null) {
            throw new IllegalStateException("Google Calendar access token 갱신에 실패했습니다.");
        }
        return response.accessToken();
    }

    @Override
    public List<GoogleCalendar> findCalendars(String accessToken) {
        GoogleCalendarListResponse response = restClient.get()
                .uri(CALENDAR_LIST_URI)
                .headers(headers -> headers.setBearerAuth(accessToken))
                .retrieve()
                .body(GoogleCalendarListResponse.class);

        if (response == null || response.items() == null) {
            return List.of();
        }
        return response.items().stream()
                .filter(item -> item.id() != null && item.summary() != null)
                .map(item -> new GoogleCalendar(
                        item.id(),
                        item.summaryOverride() == null || item.summaryOverride().isBlank()
                                ? item.summary() : item.summaryOverride(),
                        item.backgroundColor(),
                        Boolean.TRUE.equals(item.primary())
                ))
                .toList();
    }

    @Override
    public List<GoogleCalendarEvent> findEvents(
            String accessToken,
            String calendarId,
            LocalDateTime from,
            LocalDateTime to
    ) {
        List<GoogleCalendarEvent> events = new ArrayList<>();
        String pageToken = null;
        do {
            GoogleCalendarEventsResponse response = restClient.get()
                    .uri(createEventsUri(calendarId, from, to, pageToken))
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .retrieve()
                    .body(GoogleCalendarEventsResponse.class);

            if (response == null) {
                break;
            }
            if (response.items() != null) {
                events.addAll(response.items().stream()
                        .filter(item -> item.id() != null && item.start() != null && item.end() != null)
                        .map(this::toGoogleCalendarEvent)
                        .toList());
            }
            pageToken = response.nextPageToken();
        } while (pageToken != null && !pageToken.isBlank());

        return events;
    }

    static URI createEventsUri(String calendarId, LocalDateTime from, LocalDateTime to) {
        return createEventsUri(calendarId, from, to, null);
    }

    static URI createEventsUri(
            String calendarId,
            LocalDateTime from,
            LocalDateTime to,
            String pageToken
    ) {
        String baseUri = UriComponentsBuilder.fromUriString(EVENTS_URI)
                .buildAndExpand(calendarId)
                .encode()
                .toUriString();
        String timeMin = URLEncoder.encode(
                GOOGLE_DATE_TIME_FORMATTER.format(from.atZone(KOREA_TIME_ZONE)), StandardCharsets.UTF_8
        );
        String timeMax = URLEncoder.encode(
                GOOGLE_DATE_TIME_FORMATTER.format(to.atZone(KOREA_TIME_ZONE)), StandardCharsets.UTF_8
        );
        String pageTokenQuery = pageToken == null || pageToken.isBlank()
                ? ""
                : "&pageToken=" + URLEncoder.encode(pageToken, StandardCharsets.UTF_8);
        return URI.create(baseUri + "?timeMin=" + timeMin
                + "&timeMax=" + timeMax
                + "&singleEvents=true&orderBy=startTime"
                + pageTokenQuery);
    }

    private void validateConfiguration() {
        if (properties.getClientId().isBlank()
                || properties.getClientSecret().isBlank()
                || properties.getRedirectUri().isBlank()) {
            throw new IllegalStateException("Google Calendar OAuth 환경변수가 설정되지 않았습니다.");
        }
    }

    private record GoogleTokenResponse(
            @JsonProperty("access_token") String accessToken,
            @JsonProperty("refresh_token") String refreshToken
    ) {
    }

    private record GoogleTokenRefreshResponse(
            @JsonProperty("access_token") String accessToken
    ) {
    }

    private record GoogleUserInfoResponse(
            @JsonProperty("sub") String subject,
            String email
    ) {
    }

    private record GoogleCalendarListResponse(List<GoogleCalendarListItem> items) {
    }

    private record GoogleCalendarListItem(
            String id,
            String summary,
            @JsonProperty("summaryOverride") String summaryOverride,
            @JsonProperty("backgroundColor") String backgroundColor,
            Boolean primary
    ) {
    }

    private GoogleCalendarEvent toGoogleCalendarEvent(GoogleCalendarEventItem item) {
        boolean allDay = item.start().date() != null;
        return new GoogleCalendarEvent(
                item.id(),
                item.summary() == null || item.summary().isBlank() ? "제목 없음" : item.summary(),
                item.description(),
                toLocalDateTime(item.start()),
                toLocalDateTime(item.end()),
                allDay,
                item.location(),
                item.colorId(),
                item.updated() == null ? null : OffsetDateTime.parse(item.updated()).toLocalDateTime()
        );
    }

    private LocalDateTime toLocalDateTime(GoogleCalendarEventDateTime value) {
        if (value.dateTime() != null) {
            return OffsetDateTime.parse(value.dateTime()).toLocalDateTime();
        }
        return LocalDate.parse(value.date()).atStartOfDay();
    }

    private record GoogleCalendarEventsResponse(
            List<GoogleCalendarEventItem> items,
            @JsonProperty("nextPageToken") String nextPageToken
    ) {
    }

    private record GoogleCalendarEventItem(
            String id,
            String summary,
            String description,
            String location,
            @JsonProperty("colorId") String colorId,
            String updated,
            GoogleCalendarEventDateTime start,
            GoogleCalendarEventDateTime end
    ) {
    }

    private record GoogleCalendarEventDateTime(String date, @JsonProperty("dateTime") String dateTime) {
    }
}
