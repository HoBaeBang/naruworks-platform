package com.naruworks.infrastructure.persistence.drive;

import com.naruworks.core.port.DriveFileReader;
import com.naruworks.domain.model.DriveFile;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Map;
import java.util.function.Function;

@Repository
@RequiredArgsConstructor
public class DriveFilePersistenceAdapter implements DriveFileReader {

    private final DriveFilesJpaRepository driveFilesJpaRepository;

    @Override
    public Map<Long, DriveFile> findByDriveEntryIds(Collection<Long> driveEntryIds) {
        return driveFilesJpaRepository.findAllByDriveEntryIdIn(driveEntryIds).stream()
                .map(DriveFilesEntity::toDomain)
                .collect(java.util.stream.Collectors.toUnmodifiableMap(
                        DriveFile::getDriveEntryId,
                        Function.identity()
                ));
    }
}
