package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.model.GoogleCalendarEvent;
import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationReader;
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
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ExternalCalendarEventServiceTest {

    @Mock
    private CalendarIntegrationReader calendarIntegrationReader;
    @Mock
    private CalendarIntegrationCalendarReader calendarIntegrationCalendarReader;
    @Mock
    private ExternalCalendarEventReader externalCalendarEventReader;
    @Mock
    private ExternalCalendarEventWriter externalCalendarEventWriter;
    @Mock
    private GoogleCalendarOAuthClient googleCalendarOAuthClient;
    @Mock
    private SensitiveDataEncryptor sensitiveDataEncryptor;

    @Test
    @DisplayName("선택한 Google 캘린더의 이벤트만 외부 일정 저장소에 반영한다")
    void synchronizeAndFindEvents() {
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

        given(calendarIntegrationReader.findByMemberIdAndProvider(1L, CalendarIntegrationProvider.GOOGLE))
                .willReturn(Optional.of(integration));
        given(calendarIntegrationCalendarReader.findAllByCalendarIntegrationId(10L))
                .willReturn(List.of(selected, unselected));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.findEvents("access-token", "primary", from, to))
                .willReturn(List.of(googleEvent));
        given(externalCalendarEventReader.findAllDisplayEvents(1L, from, to)).willReturn(List.of());

        service().synchronizeAndFindEvents(1L, from, to);

        ArgumentCaptor<List<ExternalCalendarEvent>> captor = ArgumentCaptor.forClass(List.class);
        then(externalCalendarEventWriter).should().upsertAll(captor.capture());
        ExternalCalendarEvent saved = captor.getValue().getFirst();
        assertThat(saved.getCalendarIntegrationCalendarId()).isEqualTo(100L);
        assertThat(saved.getProviderEventId()).isEqualTo("google-event-1");
        assertThat(saved.getTitle()).isEqualTo("회의");
        assertThat(saved.getColor()).isEqualTo("#20b977");
        then(googleCalendarOAuthClient).shouldHaveNoMoreInteractions();
    }

    private ExternalCalendarEventService service() {
        return new ExternalCalendarEventService(
                calendarIntegrationReader,
                calendarIntegrationCalendarReader,
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
