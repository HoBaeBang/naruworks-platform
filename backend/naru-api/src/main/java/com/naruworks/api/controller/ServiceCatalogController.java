package com.naruworks.api.controller;

import com.naruworks.api.dto.response.ServiceCatalogResponse;
import com.naruworks.core.service.CatalogService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ServiceCatalogController {

    private final CatalogService catalogService;

    @GetMapping("/api/services")
    public List<ServiceCatalogResponse> getServices() {
        return catalogService.findPublicServices()
                .stream()
                .map(ServiceCatalogResponse::from)
                .toList();
    }
}
