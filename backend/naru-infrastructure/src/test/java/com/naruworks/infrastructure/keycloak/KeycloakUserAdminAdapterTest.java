package com.naruworks.infrastructure.keycloak;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KeycloakUserAdminAdapterTest {

    private static final String BASE_URL = "http://keycloak:8080";
    private static final String TOKEN_URL = BASE_URL + "/realms/naruworks/protocol/openid-connect/token";
    private static final String USER_URL = BASE_URL + "/admin/realms/naruworks/users/user-1";

    private MockRestServiceServer server;
    private KeycloakUserAdminAdapter adapter;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        adapter = new KeycloakUserAdminAdapter(properties(BASE_URL, "secret"), builder.build());
    }

    @Test
    @DisplayName("서비스 계정 토큰으로 사용자를 삭제한다")
    void deleteUser() {
        expectToken();
        server.expect(requestTo(USER_URL))
                .andExpect(method(HttpMethod.DELETE))
                .andExpect(header("Authorization", "Bearer admin-token"))
                .andRespond(withStatus(HttpStatus.NO_CONTENT));

        adapter.deleteUser("user-1");

        server.verify();
    }

    @Test
    @DisplayName("이미 없는 사용자(404)는 성공으로 본다")
    void deleteMissingUser() {
        expectToken();
        server.expect(requestTo(USER_URL)).andRespond(withStatus(HttpStatus.NOT_FOUND));

        adapter.deleteUser("user-1");

        server.verify();
    }

    @Test
    @DisplayName("삭제가 403 등으로 실패하면 예외를 던진다")
    void deleteFailure() {
        expectToken();
        server.expect(requestTo(USER_URL)).andRespond(withStatus(HttpStatus.FORBIDDEN));

        assertThatThrownBy(() -> adapter.deleteUser("user-1")).isInstanceOf(RuntimeException.class);
    }

    @Test
    @DisplayName("시크릿이 비어 있으면 호출하지 않고 예외를 던진다")
    void notConfigured() {
        KeycloakUserAdminAdapter unconfigured =
                new KeycloakUserAdminAdapter(properties(BASE_URL, ""), RestClient.builder().build());

        assertThatThrownBy(() -> unconfigured.deleteUser("user-1")).isInstanceOf(IllegalStateException.class);
    }

    private void expectToken() {
        server.expect(requestTo(TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"access_token\":\"admin-token\"}", MediaType.APPLICATION_JSON));
    }

    private static KeycloakAdminProperties properties(String baseUrl, String secret) {
        KeycloakAdminProperties properties = new KeycloakAdminProperties();
        ReflectionTestUtils.setField(properties, "baseUrl", baseUrl);
        ReflectionTestUtils.setField(properties, "realm", "naruworks");
        ReflectionTestUtils.setField(properties, "clientId", "naru-api-admin");
        ReflectionTestUtils.setField(properties, "clientSecret", secret);
        return properties;
    }
}
