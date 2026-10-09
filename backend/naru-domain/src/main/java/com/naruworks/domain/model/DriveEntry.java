package com.naruworks.domain.model;

import com.naruworks.domain.type.DriveEntryType;
import lombok.Builder;
import lombok.Getter;


import java.time.LocalDateTime;

@Getter
@Builder
public class DriveEntry {

    private Long id;
    private Long ownerMemberId;
    private Long parentId;
    private DriveEntryType entryType;
    private String name;
    private LocalDateTime deletedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public static DriveEntry create(Long ownerMemberId, Long parentId, DriveEntryType entryType, String name) {
        return DriveEntry.builder()
                .ownerMemberId(ownerMemberId)
                .parentId(parentId)
                .entryType(entryType)
                .name(name)
                .build();
    }
}
