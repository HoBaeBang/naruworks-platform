package com.naruworks.api.dto.response;

public record HealthResponse(
        String status,
        String service
) {

    public static HealthResponse ok() {
        return new HealthResponse("OK", "naru-api");
    }
}
