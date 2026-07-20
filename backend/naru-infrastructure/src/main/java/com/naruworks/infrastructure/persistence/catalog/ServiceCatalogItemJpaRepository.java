package com.naruworks.infrastructure.persistence.catalog;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceCatalogItemJpaRepository extends JpaRepository<ServiceCatalogItemEntity, Long> {

    List<ServiceCatalogItemEntity> findAllByOrderByDisplayOrderAsc();
}
