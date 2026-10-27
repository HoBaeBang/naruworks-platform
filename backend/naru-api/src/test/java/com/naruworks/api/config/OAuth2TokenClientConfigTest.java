package com.naruworks.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.endpoint.OAuth2AccessTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.endpoint.OAuth2AccessTokenResponse;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationExchange;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationResponse;

class OAuth2TokenClientConfigTest {

    @Test
    @DisplayName("토큰 요청은 HTTP/2 업그레이드 없이 HTTP/1.1 본문으로 전달된다")
    void tokenRequestIsPlainHttp11() throws Exception {
        AtomicReference<String> upgradeHeader = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();

        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/token", exchange -> {
            upgradeHeader.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));

            byte[] response = """
                    {"access_token":"at","token_type":"Bearer","expires_in":60}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> client =
                    new OAuth2TokenClientConfig().authorizationCodeTokenResponseClient();

            OAuth2AccessTokenResponse tokenResponse = client.getTokenResponse(
                    grantRequest("http://localhost:" + server.getAddress().getPort() + "/token")
            );

            assertThat(tokenResponse.getAccessToken().getTokenValue()).isEqualTo("at");
            assertThat(upgradeHeader.get()).isNull();
            assertThat(body.get()).contains("grant_type=authorization_code");
        } finally {
            server.stop(0);
        }
    }

    private OAuth2AuthorizationCodeGrantRequest grantRequest(String tokenUri) {
        ClientRegistration registration = ClientRegistration.withRegistrationId("authentik")
                .clientId("client-id")
                .clientSecret("client-secret")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("http://localhost:8081/login/oauth2/code/authentik")
                .authorizationUri("http://localhost/authorize")
                .tokenUri(tokenUri)
                .build();

        OAuth2AuthorizationRequest authorizationRequest = OAuth2AuthorizationRequest.authorizationCode()
                .authorizationUri("http://localhost/authorize")
                .clientId("client-id")
                .redirectUri("http://localhost:8081/login/oauth2/code/authentik")
                .state("state")
                .build();
        OAuth2AuthorizationResponse authorizationResponse = OAuth2AuthorizationResponse.success("code")
                .redirectUri("http://localhost:8081/login/oauth2/code/authentik")
                .state("state")
                .build();

        return new OAuth2AuthorizationCodeGrantRequest(
                registration,
                new OAuth2AuthorizationExchange(authorizationRequest, authorizationResponse)
        );
    }
}
