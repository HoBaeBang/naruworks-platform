package com.naruworks.infrastructure.config;

import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@Configuration
@EntityScan(basePackages = "com.naruworks.infrastructure.persistence")
@EnableJpaRepositories(basePackages = "com.naruworks.infrastructure.persistence")
public class JpaConfig {
}
