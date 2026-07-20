package com.naruworks.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "com.naruworks")
public class NaruApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(NaruApiApplication.class, args);
    }
}
