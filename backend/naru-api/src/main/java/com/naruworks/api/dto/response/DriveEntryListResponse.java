package com.naruworks.api.dto.response;

import com.naruworks.core.model.DriveEntryList;

import java.util.List;

public record DriveEntryListResponse(
        DriveEntryResponse parent,
        List<DriveEntryResponse> entries
) {

    public static DriveEntryListResponse from(DriveEntryList result) {
        DriveEntryResponse parent = result.parent() == null
                ? null
                : DriveEntryResponse.from(result.parent(), null);
        List<DriveEntryResponse> entries = result.entries().stream()
                .map(entry -> DriveEntryResponse.from(
                        entry,
                        result.findFileByEntryId(entry.getId()).orElse(null)
                ))
                .toList();
        return new DriveEntryListResponse(parent, entries);
    }
}
