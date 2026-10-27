package com.naruworks.infrastructure.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.mock.http.client.MockClientHttpResponse;

class ExternalApiLoggingInterceptorTest {

    private final Logger logger = Logger.getLogger(ExternalApiLoggingInterceptor.LOGGER_NAME);
    private final List<LogRecord> records = new ArrayList<>();
    private Handler handler;

    @BeforeEach
    void attachHandler() {
        handler = new Handler() {
            @Override
            public void publish(LogRecord record) {
                records.add(record);
            }

            @Override
            public void flush() {
            }

            @Override
            public void close() {
            }
        };
        logger.addHandler(handler);
        logger.setUseParentHandlers(false);
    }

    @AfterEach
    void detachHandler() {
        logger.removeHandler(handler);
        logger.setUseParentHandlers(true);
    }

    @Test
    @DisplayName("성공 응답은 INFO로 제공자, 메서드, 주소, 상태, 소요 시간을 한 줄로 남긴다")
    void logsSuccess() throws Exception {
        call("POST", "https://oauth2.googleapis.com/token", HttpStatus.OK);

        assertThat(records).hasSize(1);
        assertThat(records.get(0).getLevel()).isEqualTo(Level.INFO);
        assertThat(records.get(0).getMessage()).matches(
                "\\[EXTERNAL-API\\] provider=GOOGLE_CALENDAR method=POST "
                        + "url=https://oauth2.googleapis.com/token status=200 elapsedMs=\\d+"
        );
    }

    @Test
    @DisplayName("4xx 응답은 WARNING, 5xx 응답은 SEVERE로 남긴다")
    void logsErrorLevels() throws Exception {
        call("POST", "https://oauth2.googleapis.com/token", HttpStatus.BAD_REQUEST);
        call("GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList", HttpStatus.BAD_GATEWAY);

        assertThat(records).extracting(LogRecord::getLevel).containsExactly(Level.WARNING, Level.SEVERE);
        assertThat(records.get(0).getMessage()).contains("status=400");
        assertThat(records.get(1).getMessage()).contains("status=502");
    }

    @Test
    @DisplayName("쿼리 문자열과 이메일 형태의 경로 값은 로그에 남기지 않는다")
    void doesNotLogQueryOrEmail() throws Exception {
        call(
                "GET",
                "https://www.googleapis.com/calendar/v3/calendars/someone@gmail.com/events"
                        + "?syncToken=SECRET&pageToken=P",
                HttpStatus.OK
        );
        call(
                "GET",
                "https://www.googleapis.com/calendar/v3/calendars/someone%40gmail.com/events?timeMin=x",
                HttpStatus.OK
        );

        assertThat(records).hasSize(2);
        assertThat(records).allSatisfy(record -> {
            assertThat(record.getMessage())
                    .contains("url=https://www.googleapis.com/calendar/v3/calendars/{id}/events")
                    .doesNotContain("SECRET", "someone", "syncToken", "?");
        });
    }

    @Test
    @DisplayName("네트워크 오류는 SEVERE로 예외 종류만 남기고 예외를 그대로 던진다")
    void logsIoFailure() {
        ExternalApiLoggingInterceptor interceptor = new ExternalApiLoggingInterceptor("GOOGLE_CALENDAR");
        MockClientHttpRequest request = new MockClientHttpRequest(
                HttpMethod.GET, URI.create("https://www.googleapis.com/x?token=SECRET"));

        assertThatThrownBy(() -> interceptor.intercept(request, new byte[0], (req, body) -> {
            throw new IOException("connect timed out for token=SECRET");
        })).isInstanceOf(IOException.class);

        assertThat(records).hasSize(1);
        assertThat(records.get(0).getLevel()).isEqualTo(Level.SEVERE);
        assertThat(records.get(0).getMessage())
                .contains("status=ERROR", "error=IOException")
                .doesNotContain("SECRET", "timed out");
    }

    private void call(String method, String url, HttpStatus responseStatus) throws Exception {
        ExternalApiLoggingInterceptor interceptor = new ExternalApiLoggingInterceptor("GOOGLE_CALENDAR");
        MockClientHttpRequest request = new MockClientHttpRequest(HttpMethod.valueOf(method), URI.create(url));

        interceptor.intercept(request, new byte[0], (req, body) -> new MockClientHttpResponse(new byte[0], responseStatus));
    }
}
