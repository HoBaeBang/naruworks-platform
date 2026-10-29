package com.naruworks.infrastructure.keycloak;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Keycloak Admin API 호출용 서비스 계정 설정값. 시크릿이 비어 있으면 호출하지 않는다. */
@Component
public class KeycloakAdminProperties {

    @Value("${naru.idp.admin.base-url:}")
    private String baseUrl;

    @Value("${naru.idp.admin.realm:naruworks}")
    private String realm;

    @Value("${naru.idp.admin.client-id:naru-api-admin}")
    private String clientId;

    @Value("${naru.idp.admin.client-secret:}")
    private String clientSecret;

    public String getBaseUrl() {
        return baseUrl;
    }

    public String getRealm() {
        return realm;
    }

    public String getClientId() {
        return clientId;
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public boolean isConfigured() {
        return !baseUrl.isBlank() && !clientSecret.isBlank();
    }
}
