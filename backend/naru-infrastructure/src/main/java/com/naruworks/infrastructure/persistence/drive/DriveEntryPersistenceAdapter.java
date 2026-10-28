package com.naruworks.infrastructure.persistence.drive;

import com.naruworks.core.port.DriveEntryReader;
import com.naruworks.core.port.DriveEntryWriter;
import com.naruworks.core.exception.DriveEntryAlreadyExistsException;
import com.naruworks.domain.model.DriveEntry;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
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
    public boolean existsActiveByOwnerMemberIdAndParentIdAndName(
            Long ownerMemberId,
            Long parentId,
            String name
    ) {
        return driveEntriesJpaRepository.existsByOwnerMemberIdAndParentIdAndNameAndDeletedAtIsNull(
                ownerMemberId, parentId, name
        );
    }

    @Override
    public DriveEntry save(DriveEntry entry) {
        try {
            return driveEntriesJpaRepository.saveAndFlush(DriveEntriesEntity.from(entry)).toDomain();
        } catch (DataIntegrityViolationException exception) {
            throw new DriveEntryAlreadyExistsException("같은 폴더에 동일한 이름의 항목이 이미 존재합니다.");
        }
    }
}
