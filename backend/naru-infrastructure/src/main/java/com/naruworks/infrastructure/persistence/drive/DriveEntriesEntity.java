package com.naruworks.infrastructure.persistence.drive;

import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.type.DriveEntryType;
import jakarta.persistence.*;
import org.aspectj.weaver.NewConstructorTypeMunger;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Table(name = "drive_entries")
@Entity
public class DriveEntriesEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "owner_member_id", nullable = false)
    private Long ownerMemberId;

    @Column(name = "parent_id")
    private Long parentId;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private DriveEntryType entryType;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public DriveEntry toDomain() {
        return DriveEntry.builder()
                .id(id)
                .ownerMemberId(ownerMemberId)
                .parentId(parentId)
                .entryType(entryType)
                .name(name)
                .deletedAt(deletedAt)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }

    public static DriveEntriesEntity from(DriveEntry driveEntry) {
        DriveEntriesEntity entity = new DriveEntriesEntity();
        entity.id = driveEntry.getId();
        entity.ownerMemberId = driveEntry.getOwnerMemberId();
        entity.parentId = driveEntry.getParentId();
        entity.entryType = driveEntry.getEntryType();
        entity.name = driveEntry.getName();
        entity.deletedAt = driveEntry.getDeletedAt();
        entity.createdAt = driveEntry.getCreatedAt()==null ? LocalDateTime.now() : driveEntry.getCreatedAt();
        entity.updatedAt = driveEntry.getUpdatedAt()==null ? LocalDateTime.now() : driveEntry.getUpdatedAt();
        return entity;
    }
}


