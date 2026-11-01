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
import java.time.LocalDateTime;

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
            throw translateConflict(exception);
        }
    }

    @Override
    public boolean renameActive(Long entryId, Long ownerMemberId, String name) {
        try {
            return driveEntriesJpaRepository.renameActive(entryId, ownerMemberId, name, LocalDateTime.now()) == 1;
        } catch (DataIntegrityViolationException exception) {
            throw translateConflict(exception);
        }
    }

    private RuntimeException translateConflict(DataIntegrityViolationException exception) {
        Throwable cause = exception;
        while (cause != null) {
            if (cause instanceof org.hibernate.exception.ConstraintViolationException violation
                    && "uk_drive_entries_active_sibling_name".equalsIgnoreCase(violation.getConstraintName())) {
                return new DriveEntryAlreadyExistsException("같은 폴더에 동일한 이름의 항목이 이미 존재합니다.");
            }
            cause = cause.getCause();
        }
        return exception;
    }
}
