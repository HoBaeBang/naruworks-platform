package com.naruworks.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.core.authority.AuthorityUtils;

class OidcLogoutUrlResolverTest {

    private static final String FRONTEND_BASE_URL = "https://app.naruworks.com";

    private final OidcUser oidcUser = new DefaultOidcUser(
            AuthorityUtils.NO_AUTHORITIES,
            new OidcIdToken(
                    "id-token-value",
                    Instant.now(),
                    Instant.now().plusSeconds(60),
                    Map.of("sub", "authentik-sub")
            )
    );

    @Test
    @DisplayName("IdP 종료 주소가 있으면 id_token_hint와 홈 복귀 주소를 담은 로그아웃 URL을 만든다")
    void resolvesLogoutUrl() {
        OidcLogoutUrlResolver resolver = resolverWith(
                registration(Map.of("end_session_endpoint",
                        "https://idp.naruworks.com/application/o/naru-api/end-session/"))
        );

        assertThat(resolver.resolve(oidcUser)).hasValue(
                "https://idp.naruworks.com/application/o/naru-api/end-session/"
                        + "?id_token_hint=id-token-value"
                        + "&post_logout_redirect_uri=https://app.naruworks.com/"
        );
    }

    @Test
    @DisplayName("로그인한 OIDC 사용자가 없으면 로그아웃 URL이 없다")
    void returnsEmptyWithoutUser() {
        OidcLogoutUrlResolver resolver = resolverWith(
                registration(Map.of("end_session_endpoint", "https://idp.example/end/"))
        );

        assertThat(resolver.resolve(null)).isEmpty();
    }

    @Test
    @DisplayName("IdP가 종료 주소를 제공하지 않으면 로그아웃 URL이 없다")
    void returnsEmptyWithoutEndSessionEndpoint() {
        OidcLogoutUrlResolver resolver = resolverWith(registration(Map.of()));

        assertThat(resolver.resolve(oidcUser)).isEmpty();
    }

    @Test
    @DisplayName("OAuth 클라이언트 설정이 없으면 로그아웃 URL이 없다")
    @SuppressWarnings("unchecked")
    void returnsEmptyWithoutClientRegistration() {
        ObjectProvider<ClientRegistrationRepository> provider = mock(ObjectProvider.class);
        given(provider.getIfAvailable()).willReturn(null);

        assertThat(new OidcLogoutUrlResolver(provider, FRONTEND_BASE_URL).resolve(oidcUser))
                .isEmpty();
    }

    private OidcLogoutUrlResolver resolverWith(ClientRegistration registration) {
        @SuppressWarnings("unchecked")
        ObjectProvider<ClientRegistrationRepository> provider = mock(ObjectProvider.class);
        given(provider.getIfAvailable())
                .willReturn(new InMemoryClientRegistrationRepository(registration));

        return new OidcLogoutUrlResolver(provider, FRONTEND_BASE_URL);
    }

    private ClientRegistration registration(Map<String, Object> configurationMetadata) {
        return ClientRegistration.withRegistrationId("authentik")
                .clientId("client-id")
                .clientSecret("client-secret")
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("https://api.naruworks.com/login/oauth2/code/authentik")
                .authorizationUri("https://idp.naruworks.com/application/o/authorize/")
                .tokenUri("https://idp.naruworks.com/application/o/token/")
                .providerConfigurationMetadata(configurationMetadata)
                .build();
    }
}
