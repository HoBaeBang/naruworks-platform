package com.naruworks.infrastructure.persistence.drive;

import com.naruworks.core.port.DriveEntryReader;
import com.naruworks.core.port.DriveEntryWriter;
import com.naruworks.domain.model.DriveEntry;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class DriveEntryPersistenceAdapter implements DriveEntryReader, DriveEntryWriter {

    private final DriveEntriesJpaRepository driveEntriesJpaRepository;

    @Override
    public Optional<DriveEntry> findActiveByIdAndOwnerMemberId(Long entryId, Long ownerMemberId) {
        return driveEntriesJpaRepository.findByIdAndOwnerMemberIdAndDeletedAtIsNull(entryId, ownerMemberId)
                .map(DriveEntriesEntity::toDomain);
    }

    @Override
    public List<DriveEntry> findActiveChildren(Long ownerMemberId, Long parentId) {
        return driveEntriesJpaRepository.findActiveChildren(ownerMemberId, parentId)
                .stream().map(DriveEntriesEntity::toDomain).toList();
    }

    @Override
    public DriveEntry save(DriveEntry entry) {
        return driveEntriesJpaRepository.save(DriveEntriesEntity.from(entry)).toDomain();
    }
}
