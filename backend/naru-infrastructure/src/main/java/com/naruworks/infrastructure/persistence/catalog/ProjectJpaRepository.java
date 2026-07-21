package com.naruworks.infrastructure.persistence.catalog;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;


public interface ProjectJpaRepository extends JpaRepository<ProjectEntity, Long> {

    List<ProjectEntity> findAllByOrderByDisplayOrderAsc();
}
