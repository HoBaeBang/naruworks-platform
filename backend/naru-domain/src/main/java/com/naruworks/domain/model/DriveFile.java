package com.naruworks.domain.model;

import com.naruworks.domain.type.UploadStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Builder
@Getter
public class DriveFile {

    private Long driveEntryId;

    private String storageKey;

    private Long sizeBytes;

    private String contentType;

    private String sha256;

    private UploadStatus uploadStatus;

    private LocalDateTime uploadStartedAt;
}
