package com.naruworks.infrastructure.calendar;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.time.LocalDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class GoogleCalendarOAuthAdapterTest {

    @Test
    @DisplayName("Google Events API URI는 절대 HTTPS 주소와 인코딩된 캘린더 식별자를 사용한다")
    void createEventsUri() {
        URI uri = GoogleCalendarOAuthAdapter.createEventsUri(
                "aslanhobae@gmail.com",
                LocalDateTime.of(2026, 9, 1, 0, 0),
                LocalDateTime.of(2026, 10, 1, 0, 0)
        );

        assertThat(uri.getScheme()).isEqualTo("https");
        assertThat(uri.getHost()).isEqualTo("www.googleapis.com");
        assertThat(uri.getRawPath()).isEqualTo("/calendar/v3/calendars/aslanhobae@gmail.com/events");
        assertThat(uri.getRawQuery()).contains("timeMin=2026-09-01T00%3A00%3A00%2B09%3A00");
        assertThat(uri.getRawQuery()).contains("timeMax=2026-10-01T00%3A00%3A00%2B09%3A00");
    }
}
