package com.naruworks.api.dto.response;

import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.model.DriveFile;
import com.naruworks.domain.type.DriveEntryType;

import java.time.LocalDateTime;

public record DriveEntryResponse(
        Long id,
        DriveEntryType type,
        String name,
        Long sizeBytes,
        String contentType,
        LocalDateTime updatedAt
) {

    public static DriveEntryResponse from(DriveEntry entry, DriveFile file) {
        return new DriveEntryResponse(
                entry.getId(),
                entry.getEntryType(),
                entry.getName(),
                file == null ? null : file.getSizeBytes(),
                file == null ? null : file.getContentType(),
                entry.getUpdatedAt()
        );
    }
}
