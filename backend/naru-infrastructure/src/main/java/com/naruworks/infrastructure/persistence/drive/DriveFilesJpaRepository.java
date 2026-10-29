package com.naruworks.infrastructure.persistence.drive;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DriveFilesJpaRepository extends JpaRepository<DriveFilesEntity, Long> {
}
