package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.model.GoogleCalendarEvent;
import com.naruworks.core.model.GoogleCalendarSyncResult;
import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationCalendarWriter;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.core.port.ExternalCalendarEventReader;
import com.naruworks.core.port.ExternalCalendarEventWriter;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import com.naruworks.core.port.SensitiveDataEncryptor;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.CalendarIntegrationCalendar;
import com.naruworks.domain.model.ExternalCalendarEvent;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ExternalCalendarEventServiceTest {

    @Mock
    private CalendarIntegrationReader calendarIntegrationReader;
    @Mock
    private CalendarIntegrationWriter calendarIntegrationWriter;
    @Mock
    private CalendarIntegrationCalendarReader calendarIntegrationCalendarReader;
    @Mock
    private CalendarIntegrationCalendarWriter calendarIntegrationCalendarWriter;
    @Mock
    private ExternalCalendarEventReader externalCalendarEventReader;
    @Mock
    private ExternalCalendarEventWriter externalCalendarEventWriter;
    @Mock
    private GoogleCalendarOAuthClient googleCalendarOAuthClient;
    @Mock
    private SensitiveDataEncryptor sensitiveDataEncryptor;
    @Captor
    private ArgumentCaptor<List<ExternalCalendarEvent>> externalEventsCaptor;
    @Captor
    private ArgumentCaptor<List<CalendarIntegrationCalendar>> integrationCalendarsCaptor;

    @Test
    @DisplayName("30분 동기화 작업은 선택한 Google 캘린더의 이벤트만 외부 일정 저장소에 반영한다")
    void synchronizeAllConnectedGoogleCalendars() {
        LocalDateTime from = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 10, 1, 0, 0);
        CalendarIntegration integration = connectedIntegration();
        CalendarIntegrationCalendar selected = CalendarIntegrationCalendar.create(
                10L, "primary", "개인", "#20b977", true, from
        ).toBuilder().id(100L).build();
        CalendarIntegrationCalendar unselected = CalendarIntegrationCalendar.create(
                10L, "family", "가족", "#4285f4", false, from
        ).toBuilder().id(101L).build();
        GoogleCalendarEvent googleEvent = new GoogleCalendarEvent(
                "google-event-1", "회의", "주간 회의",
                LocalDateTime.of(2026, 9, 8, 10, 0),
                LocalDateTime.of(2026, 9, 8, 11, 0),
                false, "회의실", null, LocalDateTime.of(2026, 9, 1, 12, 0)
        );

        given(calendarIntegrationReader.findAllByProviderAndStatus(
                CalendarIntegrationProvider.GOOGLE, CalendarIntegrationStatus.CONNECTED
        ))
                .willReturn(List.of(integration));
        given(calendarIntegrationCalendarReader.findAllByCalendarIntegrationId(10L))
                .willReturn(List.of(selected, unselected));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.synchronizeEvents("access-token", "primary", null))
                .willReturn(new GoogleCalendarSyncResult(List.of(googleEvent), List.of(), "next-sync-token", false));
        service().synchronizeAllConnectedGoogleCalendars();

        then(externalCalendarEventWriter).should().upsertAll(externalEventsCaptor.capture());
        ExternalCalendarEvent saved = externalEventsCaptor.getValue().getFirst();
        assertThat(saved.getCalendarIntegrationCalendarId()).isEqualTo(100L);
        assertThat(saved.getProviderEventId()).isEqualTo("google-event-1");
        assertThat(saved.getTitle()).isEqualTo("회의");
        assertThat(saved.getColor()).isEqualTo("#20b977");
        then(calendarIntegrationCalendarWriter).should().saveAll(integrationCalendarsCaptor.capture());
        assertThat(integrationCalendarsCaptor.getValue().getFirst().getSyncToken()).isEqualTo("next-sync-token");
    }

    @Test
    @DisplayName("증분 동기화에서 취소된 Google 일정은 저장본에서도 제거한다")
    void synchronizeAllConnectedGoogleCalendars_removesCancelledEvents() {
        LocalDateTime from = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 10, 1, 0, 0);
        CalendarIntegration integration = connectedIntegration();
        CalendarIntegrationCalendar selected = CalendarIntegrationCalendar.create(
                10L, "primary", "개인", "#20b977", true, from
        ).toBuilder().id(100L).syncToken("previous-sync-token").build();
        given(calendarIntegrationReader.findAllByProviderAndStatus(
                CalendarIntegrationProvider.GOOGLE, CalendarIntegrationStatus.CONNECTED
        ))
                .willReturn(List.of(integration));
        given(calendarIntegrationCalendarReader.findAllByCalendarIntegrationId(10L))
                .willReturn(List.of(selected));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.synchronizeEvents("access-token", "primary", "previous-sync-token"))
                .willReturn(new GoogleCalendarSyncResult(List.of(), List.of("deleted-event"), "next-sync-token", false));
        service().synchronizeAllConnectedGoogleCalendars();

        then(externalCalendarEventWriter).should()
                .deleteByCalendarIntegrationCalendarIdAndProviderEventIds(100L, List.of("deleted-event"));
        then(externalCalendarEventWriter).shouldHaveNoMoreInteractions();
    }

    @Test
    @DisplayName("만료된 증분 토큰은 전체 동기화로 한 번 복구한다")
    void synchronizeAllConnectedGoogleCalendars_recoversExpiredSyncToken() {
        LocalDateTime from = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 10, 1, 0, 0);
        CalendarIntegration integration = connectedIntegration();
        CalendarIntegrationCalendar selected = CalendarIntegrationCalendar.create(
                10L, "primary", "개인", "#20b977", true, from
        ).toBuilder().id(100L).syncToken("expired-token").build();
        given(calendarIntegrationReader.findAllByProviderAndStatus(
                CalendarIntegrationProvider.GOOGLE, CalendarIntegrationStatus.CONNECTED
        ))
                .willReturn(List.of(integration));
        given(calendarIntegrationCalendarReader.findAllByCalendarIntegrationId(10L))
                .willReturn(List.of(selected));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.synchronizeEvents("access-token", "primary", "expired-token"))
                .willReturn(GoogleCalendarSyncResult.expired());
        given(googleCalendarOAuthClient.synchronizeEvents("access-token", "primary", null))
                .willReturn(new GoogleCalendarSyncResult(List.of(), List.of(), "recovered-sync-token", false));
        service().synchronizeAllConnectedGoogleCalendars();

        then(googleCalendarOAuthClient).should().synchronizeEvents("access-token", "primary", "expired-token");
        then(googleCalendarOAuthClient).should().synchronizeEvents("access-token", "primary", null);
        then(externalCalendarEventWriter).should().deleteAllByCalendarIntegrationCalendarId(100L);
    }

    @Test
    @DisplayName("Calendar 화면 조회는 마지막 외부 일정 저장본만 읽고 Google API를 호출하지 않는다")
    void findEvents_readsSavedEventsWithoutSynchronizing() {
        LocalDateTime from = LocalDateTime.of(2026, 9, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 10, 1, 0, 0);
        ExternalCalendarEvent saved = ExternalCalendarEvent.create(
                100L, "google-event-1", "회의", null, from, from.plusHours(1),
                false, null, "#20b977", null, from
        );
        given(externalCalendarEventReader.findAllDisplayEvents(1L, from, to)).willReturn(List.of(saved));

        List<ExternalCalendarEvent> result = service().findEvents(1L, from, to);

        assertThat(result).containsExactly(saved);
        then(googleCalendarOAuthClient).shouldHaveNoInteractions();
    }

    private ExternalCalendarEventService service() {
        return new ExternalCalendarEventService(
                calendarIntegrationReader,
                calendarIntegrationWriter,
                calendarIntegrationCalendarReader,
                calendarIntegrationCalendarWriter,
                externalCalendarEventReader,
                externalCalendarEventWriter,
                googleCalendarOAuthClient,
                sensitiveDataEncryptor,
                Clock.fixed(Instant.parse("2026-09-01T00:00:00Z"), ZoneId.of("Asia/Seoul"))
        );
    }

    private CalendarIntegration connectedIntegration() {
        return CalendarIntegration.builder()
                .id(10L)
                .memberId(1L)
                .provider(CalendarIntegrationProvider.GOOGLE)
                .providerAccountId("google-account")
                .providerEmail("calendar@example.com")
                .encryptedRefreshToken("encrypted-refresh-token")
                .status(CalendarIntegrationStatus.CONNECTED)
                .createdAt(LocalDateTime.of(2026, 9, 1, 0, 0))
                .updatedAt(LocalDateTime.of(2026, 9, 1, 0, 0))
                .build();
    }
}
