package com.naruworks.api.security;

import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

@Component
public class OidcLogoutUrlResolver {

    private static final String REGISTRATION_ID = "authentik";
    private static final String END_SESSION_ENDPOINT = "end_session_endpoint";

    private final ObjectProvider<ClientRegistrationRepository> clientRegistrationRepository;
    private final String frontendBaseUrl;

    public OidcLogoutUrlResolver(
            ObjectProvider<ClientRegistrationRepository> clientRegistrationRepository,
            @Value("${naru.frontend-base-url}") String frontendBaseUrl
    ) {
        this.clientRegistrationRepository = clientRegistrationRepository;
        this.frontendBaseUrl = frontendBaseUrl;
    }

    public Optional<String> resolve(OidcUser oidcUser) {
        if (oidcUser == null) {
            return Optional.empty();
        }

        ClientRegistrationRepository repository = clientRegistrationRepository.getIfAvailable();
        ClientRegistration registration = repository == null
                ? null
                : repository.findByRegistrationId(REGISTRATION_ID);

        if (registration == null) {
            return Optional.empty();
        }

        Object endSessionEndpoint = registration.getProviderDetails()
                .getConfigurationMetadata()
                .get(END_SESSION_ENDPOINT);

        if (endSessionEndpoint == null) {
            return Optional.empty();
        }

        return Optional.of(UriComponentsBuilder.fromUriString(endSessionEndpoint.toString())
                .queryParam("id_token_hint", oidcUser.getIdToken().getTokenValue())
                .queryParam("post_logout_redirect_uri", frontendBaseUrl + "/")
                .build()
                .toUriString());
    }
}
