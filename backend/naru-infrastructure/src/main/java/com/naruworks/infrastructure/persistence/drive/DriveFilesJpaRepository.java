package com.naruworks.infrastructure.persistence.drive;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface DriveFilesJpaRepository extends JpaRepository<DriveFilesEntity, Long> {

    List<DriveFilesEntity> findAllByDriveEntryIdIn(Collection<Long> driveEntryIds);
}
