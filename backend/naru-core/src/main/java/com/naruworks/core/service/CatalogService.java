package com.naruworks.core.service;

import com.naruworks.core.port.CatalogReader;
import com.naruworks.domain.model.Project;
import com.naruworks.domain.model.ServiceCatalogItem;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CatalogService {

    private final CatalogReader catalogReader;

    public List<Project> findPublicProjects() {
        return catalogReader.findPublicProjects();
    }

    public List<ServiceCatalogItem> findPublicServices() {
        return catalogReader.findPublicServices();
    }
}
