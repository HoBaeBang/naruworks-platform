package com.naruworks.infrastructure.persistence.catalog;

import com.naruworks.core.port.CatalogReader;
import com.naruworks.domain.model.Project;
import com.naruworks.domain.model.ServiceCatalogItem;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class CatalogReaderAdapter implements CatalogReader {

    private final ProjectJpaRepository projectJpaRepository;
    private final ServiceCatalogItemJpaRepository serviceCatalogItemJpaRepository;

    @Override
    public List<Project> findPublicProjects() {
        return projectJpaRepository.findAllByOrderByDisplayOrderAsc()
                .stream()
                .map(ProjectEntity::toDomain)
                .toList();
    }

    @Override
    public List<ServiceCatalogItem> findPublicServices() {
        return serviceCatalogItemJpaRepository.findAllByOrderByDisplayOrderAsc()
                .stream()
                .map(ServiceCatalogItemEntity::toDomain)
                .toList();
    }
}
