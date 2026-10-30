package com.naruworks.core.port;

import com.naruworks.domain.model.DriveEntry;

public interface DriveEntryWriter {

    DriveEntry save(DriveEntry entry);

    boolean renameActive(Long entryId, Long ownerMemberId, String name);
}
