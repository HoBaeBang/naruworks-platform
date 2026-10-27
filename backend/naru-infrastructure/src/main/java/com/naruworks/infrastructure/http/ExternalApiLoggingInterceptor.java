package com.naruworks.infrastructure.http;

import java.io.IOException;
import java.net.URI;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;

/**
 * 외부 API 호출을 한 줄로 기록한다. 다른 로그와 구분되도록 전용 로거와 [EXTERNAL-API] 접두어를 사용한다.
 * 토큰이나 개인정보가 남지 않도록 본문, 쿼리 문자열, 이메일 형태의 경로 값은 기록하지 않는다.
 */
public class ExternalApiLoggingInterceptor implements ClientHttpRequestInterceptor {

    static final String LOGGER_NAME = "naruworks.external-api";
    private static final Logger LOGGER = Logger.getLogger(LOGGER_NAME);
    private static final String DIVIDER = "[EXTERNAL-API] " + "-".repeat(60);

    private final String provider;

    public ExternalApiLoggingInterceptor(String provider) {
        this.provider = provider;
    }

    @Override
    public ClientHttpResponse intercept(
            HttpRequest request,
            byte[] body,
            ClientHttpRequestExecution execution
    ) throws IOException {
        long startedAt = System.nanoTime();
        try {
            ClientHttpResponse response = execution.execute(request, body);
            int status = response.getStatusCode().value();
            log(levelOf(status), request, String.valueOf(status), startedAt, null);
            return response;
        } catch (IOException | RuntimeException exception) {
            log(Level.SEVERE, request, "ERROR", startedAt, exception.getClass().getSimpleName());
            throw exception;
        }
    }

    private void log(Level level, HttpRequest request, String status, long startedAt, String error) {
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;
        // 시작·끝 구분선을 한 레코드로 묶어, 동시에 찍히는 다른 로그와 섞이지 않게 한다.
        LOGGER.log(level, DIVIDER + "\n[EXTERNAL-API] provider=" + provider
                + " method=" + request.getMethod()
                + " url=" + safeUrl(request.getURI())
                + " status=" + status
                + " elapsedMs=" + elapsedMs
                + (error == null ? "" : " error=" + error)
                + "\n" + DIVIDER);
    }

    private Level levelOf(int status) {
        if (status >= 500) {
            return Level.SEVERE;
        }
        return status >= 400 ? Level.WARNING : Level.INFO;
    }

    // 쿼리에는 syncToken 등이, 경로에는 캘린더 ID(이메일)가 들어올 수 있어 제거하거나 가린다.
    private String safeUrl(URI uri) {
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();
        return uri.getScheme() + "://" + uri.getHost() + path.replaceAll("[^/]+(@|%40)[^/]+", "{id}");
    }
}
