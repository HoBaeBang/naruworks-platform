package com.naruworks.core.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import com.naruworks.core.port.CalendarIntegrationReader;
import com.naruworks.core.port.CalendarIntegrationWriter;
import com.naruworks.core.port.GoogleCalendarOAuthClient;
import com.naruworks.core.port.SensitiveDataEncryptor;
import com.naruworks.domain.model.CalendarIntegration;
import com.naruworks.domain.type.CalendarIntegrationProvider;
import com.naruworks.domain.type.CalendarIntegrationStatus;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Optional;
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

    private CalendarIntegrationService service() {
        return new CalendarIntegrationService(
                calendarIntegrationReader,
                calendarIntegrationWriter,
                googleCalendarOAuthClient,
                sensitiveDataEncryptor,
                Clock.fixed(Instant.parse("2026-09-10T01:00:00Z"), ZoneId.of("Asia/Seoul"))
        );
    }
}
