package com.naruworks.api.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            ObjectProvider<ClientRegistrationRepository> clientRegistrationRepository
    ) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(
                                "/api/health",
                                "/api/projects",
                                "/api/services",
                                "/api/calendar/events",
                                "/api/calendar/events/**",
                                "/oauth2/**",
                                "/login/**"
                        ).permitAll()
                        .anyRequest().permitAll()
                );

        if (clientRegistrationRepository.getIfAvailable() != null) {
            http.oauth2Login(Customizer.withDefaults());
        }

        return http.build();
    }
}
