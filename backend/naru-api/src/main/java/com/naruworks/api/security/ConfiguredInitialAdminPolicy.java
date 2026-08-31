package com.naruworks.api.security;

import com.naruworks.core.port.InitialAdminPolicy;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class ConfiguredInitialAdminPolicy implements InitialAdminPolicy {

    @Value("${naru.initial-admin-email:}")
    private String initialAdminEmail;

    @Override
    public boolean matches(String email) {
        return initialAdminEmail != null
                && !initialAdminEmail.isBlank()
                && initialAdminEmail.equalsIgnoreCase(email);
    }
}
