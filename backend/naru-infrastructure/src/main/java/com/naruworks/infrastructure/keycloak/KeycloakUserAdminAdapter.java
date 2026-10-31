package com.naruworks.infrastructure.keycloak;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.naruworks.core.port.IdentityProviderUserWriter;
import com.naruworks.infrastructure.http.ExternalApiLoggingInterceptor;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

/**
 * 서비스 계정(client credentials)으로 Keycloak Admin API를 호출한다.
 * 공개 주소는 /admin이 막혀 있으므로 base-url은 compose 내부 주소를 쓴다.
 */
@Component
public class KeycloakUserAdminAdapter implements IdentityProviderUserWriter {

    private static final String MEMBER_ROLE = "member";

    private final KeycloakAdminProperties properties;
    private final RestClient restClient;

    @Autowired
    public KeycloakUserAdminAdapter(KeycloakAdminProperties properties) {
        this(properties, RestClient.builder()
                .requestInterceptor(new ExternalApiLoggingInterceptor("KEYCLOAK_ADMIN"))
                .build());
    }

    KeycloakUserAdminAdapter(KeycloakAdminProperties properties, RestClient restClient) {
        this.properties = properties;
        this.restClient = restClient;
    }

    @Override
    public void deleteUser(String userId) {
        requireConfigured();

        try {
            restClient.delete()
                    .uri(properties.getBaseUrl() + "/admin/realms/{realm}/users/{id}", properties.getRealm(), userId)
                    .headers(headers -> headers.setBearerAuth(fetchAccessToken()))
                    .retrieve()
                    .toBodilessEntity();
        } catch (HttpClientErrorException.NotFound ignored) {
            // 이미 삭제된 사용자는 목표 상태이므로 성공으로 본다.
        }
    }

    // 서비스 계정(manage-users)은 역할 이름 조회(roles/{name})가 403이라, 사용자별 매핑 목록에서 역할 id를 찾는다.
    @Override
    public void setMemberRole(String userId, boolean member) {
        requireConfigured();

        String accessToken = fetchAccessToken();
        String mappingUri = properties.getBaseUrl() + "/admin/realms/{realm}/users/{id}/role-mappings/realm";
        Object[] variables = {properties.getRealm(), userId};

        if (member) {
            if (findRole(accessToken, mappingUri, variables).isPresent()) {
                return;
            }
            RoleRepresentation role = findRole(accessToken, mappingUri + "/available", variables)
                    .orElseThrow(() -> new IllegalStateException(
                            "Keycloak realm에 '" + MEMBER_ROLE + "' 역할이 없다. 관리 콘솔에서 만들어야 한다."));
            restClient.post()
                    .uri(mappingUri, variables)
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(List.of(role))
                    .retrieve()
                    .toBodilessEntity();
            return;
        }

        findRole(accessToken, mappingUri, variables).ifPresent(role -> restClient.method(HttpMethod.DELETE)
                .uri(mappingUri, variables)
                .headers(headers -> headers.setBearerAuth(accessToken))
                .contentType(MediaType.APPLICATION_JSON)
                .body(List.of(role))
                .retrieve()
                .toBodilessEntity());
    }

    private Optional<RoleRepresentation> findRole(String accessToken, String uri, Object[] variables) {
        RoleRepresentation[] roles = restClient.get()
                .uri(uri, variables)
                .headers(headers -> headers.setBearerAuth(accessToken))
                .retrieve()
                .body(RoleRepresentation[].class);

        return roles == null
                ? Optional.empty()
                : Arrays.stream(roles).filter(role -> MEMBER_ROLE.equals(role.name())).findFirst();
    }

    private void requireConfigured() {
        if (!properties.isConfigured()) {
            throw new IllegalStateException("Keycloak Admin 설정(naru.idp.admin.*)이 비어 있어 IdP를 호출하지 못했다.");
        }
    }

    // shortcut: 호출마다 토큰을 새로 받는다. 로그인과 상태 변경 때만 호출되므로 캐시하지 않고, 잦아지면 캐시한다.
    private String fetchAccessToken() {
        LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", properties.getClientId());
        form.add("client_secret", properties.getClientSecret());

        TokenResponse response = restClient.post()
                .uri(properties.getBaseUrl() + "/realms/{realm}/protocol/openid-connect/token", properties.getRealm())
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve()
                .body(TokenResponse.class);

        if (response == null || response.accessToken() == null) {
            throw new IllegalStateException("Keycloak 토큰 응답에 access_token이 없다.");
        }
        return response.accessToken();
    }

    private record RoleRepresentation(String id, String name) {
    }

    private record TokenResponse(@JsonProperty("access_token") String accessToken) {
    }
}
