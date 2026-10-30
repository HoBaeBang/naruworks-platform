package com.naruworks.infrastructure.keycloak;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
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

    private static final String MAPPING_URL = USER_URL + "/role-mappings/realm";
    private static final String MEMBER_ROLE_JSON = "[{\"id\":\"role-1\",\"name\":\"member\"}]";
    private static final String OTHER_ROLE_JSON = "[{\"id\":\"role-2\",\"name\":\"default-roles-naruworks\"}]";

    @Test
    @DisplayName("승인 회원 역할이 없으면 available 목록에서 찾아 부여한다")
    void grantMemberRole() {
        expectToken();
        server.expect(requestTo(MAPPING_URL)).andRespond(withSuccess(OTHER_ROLE_JSON, MediaType.APPLICATION_JSON));
        server.expect(requestTo(MAPPING_URL + "/available"))
                .andRespond(withSuccess(MEMBER_ROLE_JSON, MediaType.APPLICATION_JSON));
        server.expect(requestTo(MAPPING_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json(MEMBER_ROLE_JSON))
                .andRespond(withStatus(HttpStatus.NO_CONTENT));

        adapter.setMemberRole("user-1", true);

        server.verify();
    }

    @Test
    @DisplayName("이미 승인 회원 역할이 있으면 아무것도 보내지 않는다")
    void grantMemberRoleAlreadyGranted() {
        expectToken();
        server.expect(requestTo(MAPPING_URL)).andRespond(withSuccess(MEMBER_ROLE_JSON, MediaType.APPLICATION_JSON));

        adapter.setMemberRole("user-1", true);

        server.verify();
    }

    @Test
    @DisplayName("realm에 승인 회원 역할이 없으면 예외를 던진다")
    void grantMemberRoleMissingRole() {
        expectToken();
        server.expect(requestTo(MAPPING_URL)).andRespond(withSuccess("[]", MediaType.APPLICATION_JSON));
        server.expect(requestTo(MAPPING_URL + "/available")).andRespond(withSuccess("[]", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> adapter.setMemberRole("user-1", true))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("승인 회원 역할이 있으면 제거한다")
    void revokeMemberRole() {
        expectToken();
        server.expect(requestTo(MAPPING_URL)).andRespond(withSuccess(MEMBER_ROLE_JSON, MediaType.APPLICATION_JSON));
        server.expect(requestTo(MAPPING_URL))
                .andExpect(method(HttpMethod.DELETE))
                .andExpect(content().json(MEMBER_ROLE_JSON))
                .andRespond(withStatus(HttpStatus.NO_CONTENT));

        adapter.setMemberRole("user-1", false);

        server.verify();
    }

    @Test
    @DisplayName("승인 회원 역할이 없으면 제거 요청을 보내지 않는다")
    void revokeMemberRoleNotGranted() {
        expectToken();
        server.expect(requestTo(MAPPING_URL)).andRespond(withSuccess(OTHER_ROLE_JSON, MediaType.APPLICATION_JSON));

        adapter.setMemberRole("user-1", false);

        server.verify();
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
