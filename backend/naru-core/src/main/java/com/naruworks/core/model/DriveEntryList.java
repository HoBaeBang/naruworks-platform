package com.naruworks.core.model;

import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.model.DriveFile;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public record DriveEntryList(
        DriveEntry parent,
        List<DriveEntry> entries,
        Map<Long, DriveFile> filesByEntryId
) {

    public DriveEntryList {
        entries = List.copyOf(entries);
        filesByEntryId = Map.copyOf(filesByEntryId);
    }

    public Optional<DriveFile> findFileByEntryId(Long entryId) {
        return Optional.ofNullable(filesByEntryId.get(entryId));
    }
}
