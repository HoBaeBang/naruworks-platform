package com.naruworks.core.service;

import com.naruworks.core.exception.DriveEntryAlreadyExistsException;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.model.DriveEntryList;
import com.naruworks.core.port.DriveEntryReader;
import com.naruworks.core.port.DriveEntryWriter;
import com.naruworks.core.port.DriveFileReader;
import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.type.DriveEntryType;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class DriveEntryService {

    private static final int MAX_NAME_LENGTH = 255;

    private final DriveEntryReader driveEntryReader;
    private final DriveEntryWriter driveEntryWriter;
    private final DriveFileReader driveFileReader;

    @Transactional(readOnly = true)
    public DriveEntryList findEntries(Long ownerMemberId, Long parentId) {
        DriveEntry parent = parentId == null ? null : findActiveFolder(ownerMemberId, parentId);
        List<DriveEntry> entries = driveEntryReader.findActiveChildren(ownerMemberId, parentId);
        Map<Long, com.naruworks.domain.model.DriveFile> filesByEntryId = findFiles(entries);

        return new DriveEntryList(parent, entries, filesByEntryId);
    }

    @Transactional
    public DriveEntry createFolder(Long ownerMemberId, Long parentId, String name) {
        String normalizedName = normalizeName(name);
        if (parentId != null) {
            findActiveFolder(ownerMemberId, parentId);
        }
        if (driveEntryReader.existsActiveByOwnerMemberIdAndParentIdAndName(
                ownerMemberId, parentId, normalizedName
        )) {
            throw new DriveEntryAlreadyExistsException("같은 폴더에 동일한 이름의 항목이 이미 존재합니다.");
        }

        return driveEntryWriter.save(DriveEntry.create(
                ownerMemberId,
                parentId,
                DriveEntryType.FOLDER,
                normalizedName
        ));
    }

    /** 소유한 활성 항목의 이름을 검증하고 중복되지 않으면 변경한다. */
    @Transactional
    public DriveEntry renameEntry(Long ownerMemberId, Long entryId, String name) {
        DriveEntry entry = driveEntryReader.findActiveByIdAndOwnerMemberId(entryId, ownerMemberId)
                .orElseThrow(() -> new NotFoundException("항목을 찾을 수 없습니다."));
        String normalizedName = normalizeName(name);
        if (entry.getName().equals(normalizedName)) {
            return entry;
        }
        if (driveEntryReader.existsActiveByOwnerMemberIdAndParentIdAndName(
                ownerMemberId, entry.getParentId(), normalizedName)) {
            throw new DriveEntryAlreadyExistsException("같은 폴더에 동일한 이름의 항목이 이미 존재합니다.");
        }
        if (!driveEntryWriter.renameActive(entryId, ownerMemberId, normalizedName)) {
            throw new NotFoundException("항목을 찾을 수 없습니다.");
        }
        return driveEntryReader.findActiveByIdAndOwnerMemberId(entryId, ownerMemberId)
                .orElseThrow(() -> new NotFoundException("항목을 찾을 수 없습니다."));
    }

    private DriveEntry findActiveFolder(Long ownerMemberId, Long entryId) {
        DriveEntry entry = driveEntryReader.findActiveByIdAndOwnerMemberId(entryId, ownerMemberId)
                .orElseThrow(() -> new NotFoundException("폴더를 찾을 수 없습니다."));
        if (entry.getEntryType() != DriveEntryType.FOLDER) {
            throw new IllegalArgumentException("상위 항목은 폴더여야 합니다.");
        }
        return entry;
    }

    private Map<Long, com.naruworks.domain.model.DriveFile> findFiles(List<DriveEntry> entries) {
        List<Long> fileEntryIds = entries.stream()
                .filter(entry -> entry.getEntryType() == DriveEntryType.FILE)
                .map(DriveEntry::getId)
                .toList();
        if (fileEntryIds.isEmpty()) {
            return Map.of();
        }
        return driveFileReader.findByDriveEntryIds(fileEntryIds);
    }

    private String normalizeName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("폴더 이름은 비어 있을 수 없습니다.");
        }

        String normalizedName = name.strip();
        if (normalizedName.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("폴더 이름은 255자 이하여야 합니다.");
        }
        if (normalizedName.equals(".") || normalizedName.equals("..")
                || normalizedName.contains("/") || normalizedName.contains("\\")) {
            throw new IllegalArgumentException("폴더 이름에 경로 구분자를 사용할 수 없습니다.");
        }
        if (normalizedName.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("폴더 이름에 제어 문자를 사용할 수 없습니다.");
        }
        return normalizedName;
    }
}
