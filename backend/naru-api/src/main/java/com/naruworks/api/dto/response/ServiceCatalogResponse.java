package com.naruworks.api.dto.response;

import com.naruworks.domain.model.ServiceCatalogItem;

public record ServiceCatalogResponse(
        String slug,
        String name,
        String description,
        String status
) {

    public static ServiceCatalogResponse from(ServiceCatalogItem service) {
        return new ServiceCatalogResponse(
                service.slug(),
                service.name(),
                service.description(),
                service.status().name()
        );
    }
}
