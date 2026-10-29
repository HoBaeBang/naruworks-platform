package com.naruworks.infrastructure.persistence.drive;

import com.naruworks.domain.type.UploadStatus;
import jakarta.persistence.*;

import java.time.LocalDateTime;

@Table(
        name = "drive_files",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_drive_files_storage_key",
                        columnNames = "storage_key"
                )
        })
@Entity
public class DriveFilesEntity {

    @Id
    @Column(name = "drive_entry_id")
    private Long driveEntryId;

    @Column(name = "storage_key", nullable = false)
    private String storageKey;

    @Column(name = "size_bytes", nullable = false)
    private Long sizeBytes;

    @Column(name = "content_type", nullable = true)
    private String contentType;

    @Column(name = "sha256", nullable = true)
    private String sha256;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private UploadStatus uploadStatus;

    @Column(name = "upload_started_at", nullable = false)
    private LocalDateTime uploadStartedAt;
}

