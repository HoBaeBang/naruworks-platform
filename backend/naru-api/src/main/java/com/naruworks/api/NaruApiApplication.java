package com.naruworks.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = "com.naruworks")
@EnableScheduling
public class NaruApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(NaruApiApplication.class, args);
    }
}
