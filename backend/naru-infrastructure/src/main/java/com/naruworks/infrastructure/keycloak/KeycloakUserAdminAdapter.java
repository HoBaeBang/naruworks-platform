package com.naruworks.infrastructure.keycloak;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.naruworks.core.port.IdentityProviderUserWriter;
import com.naruworks.infrastructure.http.ExternalApiLoggingInterceptor;
import org.springframework.beans.factory.annotation.Autowired;
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
        if (!properties.isConfigured()) {
            throw new IllegalStateException("Keycloak Admin 설정(naru.idp.admin.*)이 비어 있어 사용자를 삭제하지 못했다.");
        }

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

    // shortcut: 삭제 때마다 토큰을 새로 받는다. 호출이 거절된 로그인 때만 일어나므로 캐시하지 않고, 잦아지면 캐시한다.
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

    private record TokenResponse(@JsonProperty("access_token") String accessToken) {
    }
}
