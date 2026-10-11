package com.naruworks.core.port;

import com.naruworks.domain.model.DriveEntry;

import java.util.List;
import java.util.Optional;

public interface DriveEntryReader {

    Optional<DriveEntry> findActiveByIdAndOwnerMemberId(
            Long entryId,
            Long ownerMemberId
    );

    List<DriveEntry> findActiveChildren(
            Long ownerMemberId,
            Long parentId
    );

}
