package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendar;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import com.naruworks.core.port.CalendarIntegrationCalendarReader;
import com.naruworks.core.port.CalendarIntegrationCalendarWriter;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import com.naruworks.core.port.SensitiveDataEncryptor;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.model.CalendarIntegrationCalendar;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Optional;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CalendarIntegrationServiceTest {

    @Mock
    private CalendarIntegrationReader calendarIntegrationReader;

    @Mock
    private CalendarIntegrationWriter calendarIntegrationWriter;

    @Mock
    private CalendarIntegrationCalendarReader calendarIntegrationCalendarReader;

    @Mock
    private CalendarIntegrationCalendarWriter calendarIntegrationCalendarWriter;

    @Mock
    private GoogleCalendarOAuthClient googleCalendarOAuthClient;

    @Mock
    private SensitiveDataEncryptor sensitiveDataEncryptor;

    @Test
    @DisplayName("Google Calendar 연결은 refresh token을 암호화해 회원별 연결 정보로 저장한다")
    void connectGoogleCalendar() {
        given(googleCalendarOAuthClient.exchangeAuthorizationCode("authorization-code"))
                .willReturn(new GoogleCalendarOAuthToken("access-token", "refresh-token"));
        given(googleCalendarOAuthClient.findAccount("access-token"))
                .willReturn(new GoogleCalendarAccount("google-account-id", "calendar@example.com"));
        given(sensitiveDataEncryptor.encrypt("refresh-token")).willReturn("encrypted-token");
        given(calendarIntegrationReader.findByMemberIdAndProvider(
                1L,
                CalendarIntegrationProvider.GOOGLE
        )).willReturn(Optional.empty());
        given(calendarIntegrationWriter.save(any(CalendarIntegration.class)))
                .willAnswer(invocation -> invocation.getArgument(0));

        CalendarIntegration result = service().connectGoogleCalendar(1L, "authorization-code");

        ArgumentCaptor<CalendarIntegration> captor = ArgumentCaptor.forClass(CalendarIntegration.class);
        then(calendarIntegrationWriter).should().save(captor.capture());
        assertThat(captor.getValue().getMemberId()).isEqualTo(1L);
        assertThat(captor.getValue().getProvider()).isEqualTo(CalendarIntegrationProvider.GOOGLE);
        assertThat(captor.getValue().getProviderEmail()).isEqualTo("calendar@example.com");
        assertThat(captor.getValue().getEncryptedRefreshToken()).isEqualTo("encrypted-token");
        assertThat(captor.getValue().getStatus()).isEqualTo(CalendarIntegrationStatus.CONNECTED);
        assertThat(result.getCreatedAt()).isEqualTo(captor.getValue().getCreatedAt());
    }

    @Test
    @DisplayName("Google이 refresh token을 반환하지 않으면 연결 정보를 저장하지 않는다")
    void connectGoogleCalendar_rejectsMissingRefreshToken() {
        given(googleCalendarOAuthClient.exchangeAuthorizationCode("authorization-code"))
                .willReturn(new GoogleCalendarOAuthToken("access-token", null));

        assertThatThrownBy(() -> service().connectGoogleCalendar(1L, "authorization-code"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Google Calendar 연결에 필요한 refresh token을 받지 못했습니다. 다시 연결해주세요.");

        then(calendarIntegrationWriter).shouldHaveNoInteractions();
        then(sensitiveDataEncryptor).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("Google Calendar 목록 조회는 암호화된 refresh token으로 access token을 갱신하고 선택 상태를 합친다")
    void findGoogleCalendars() {
        CalendarIntegration integration = connectedIntegration();
        given(calendarIntegrationReader.findByMemberIdAndProvider(1L, CalendarIntegrationProvider.GOOGLE))
                .willReturn(Optional.of(integration));
        given(calendarIntegrationCalendarReader.findAllByCalendarIntegrationId(10L))
                .willReturn(List.of(CalendarIntegrationCalendar.create(
                        10L, "family", "가족", "#4285F4", true, LocalDateTime.now()
                )));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.findCalendars("access-token")).willReturn(List.of(
                new GoogleCalendar("primary", "개인", "#20b977", true),
                new GoogleCalendar("family", "가족", "#4285F4", false)
        ));

        var result = service().findGoogleCalendars(1L);

        assertThat(result).extracting(item -> item.calendarId() + ":" + item.enabled())
                .containsExactly("primary:false", "family:true");
        then(sensitiveDataEncryptor).should().decrypt("encrypted-refresh-token");
        then(googleCalendarOAuthClient).should().refreshAccessToken("refresh-token");
    }

    @Test
    @DisplayName("Google Calendar 선택 저장은 Google 계정에 존재하는 캘린더만 허용한다")
    void updateGoogleCalendarSelections_rejectsUnknownCalendar() {
        given(calendarIntegrationReader.findByMemberIdAndProvider(1L, CalendarIntegrationProvider.GOOGLE))
                .willReturn(Optional.of(connectedIntegration()));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.findCalendars("access-token"))
                .willReturn(List.of(new GoogleCalendar("primary", "개인", "#20b977", true)));

        assertThatThrownBy(() -> service().updateGoogleCalendarSelections(1L, Set.of("unknown")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Google 계정에 없는 캘린더는 선택할 수 없습니다.");

        then(calendarIntegrationCalendarWriter).shouldHaveNoInteractions();
    }

    @Test
    @SuppressWarnings("unchecked")
    @DisplayName("Google Calendar 선택 저장은 선택 여부를 캘린더별 설정으로 저장한다")
    void updateGoogleCalendarSelections() {
        given(calendarIntegrationReader.findByMemberIdAndProvider(1L, CalendarIntegrationProvider.GOOGLE))
                .willReturn(Optional.of(connectedIntegration()));
        given(sensitiveDataEncryptor.decrypt("encrypted-refresh-token")).willReturn("refresh-token");
        given(googleCalendarOAuthClient.refreshAccessToken("refresh-token")).willReturn("access-token");
        given(googleCalendarOAuthClient.findCalendars("access-token")).willReturn(List.of(
                new GoogleCalendar("primary", "개인", "#20b977", true),
                new GoogleCalendar("family", "가족", "#4285F4", false)
        ));
        given(calendarIntegrationCalendarReader.findAllByCalendarIntegrationId(10L)).willReturn(List.of());
        given(calendarIntegrationCalendarWriter.saveAll(any())).willAnswer(invocation -> invocation.getArgument(0));

        var result = service().updateGoogleCalendarSelections(1L, Set.of("primary"));

        ArgumentCaptor<List<CalendarIntegrationCalendar>> captor = ArgumentCaptor.forClass(List.class);
        then(calendarIntegrationCalendarWriter).should().saveAll(captor.capture());
        assertThat(captor.getValue()).extracting(item -> item.getProviderCalendarId() + ":" + item.isEnabled())
                .containsExactly("primary:true", "family:false");
        assertThat(result).extracting(item -> item.calendarId() + ":" + item.enabled())
                .containsExactly("primary:true", "family:false");
    }

    private CalendarIntegrationService service() {
        return new CalendarIntegrationService(
                calendarIntegrationReader,
                calendarIntegrationWriter,
                calendarIntegrationCalendarReader,
                calendarIntegrationCalendarWriter,
                googleCalendarOAuthClient,
                sensitiveDataEncryptor,
                Clock.fixed(Instant.parse("2026-09-10T01:00:00Z"), ZoneId.of("Asia/Seoul"))
        );
    }

    private CalendarIntegration connectedIntegration() {
        return CalendarIntegration.connectGoogle(
                1L,
                "google-account-id",
                "calendar@example.com",
                "encrypted-refresh-token",
                LocalDateTime.of(2026, 9, 10, 10, 0)
        ).toBuilder().id(10L).build();
    }
}
