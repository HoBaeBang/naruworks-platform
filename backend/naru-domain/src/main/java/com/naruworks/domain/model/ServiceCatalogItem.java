package com.naruworks.domain.model;

import com.naruworks.domain.type.ServiceStatus;

public record ServiceCatalogItem(
        String slug,
        String name,
        String description,
        ServiceStatus status
) {

    public static ServiceCatalogItem of(
            String slug,
            String name,
            String description,
            ServiceStatus status
    ) {
        return new ServiceCatalogItem(slug, name, description, status);
    }
}
