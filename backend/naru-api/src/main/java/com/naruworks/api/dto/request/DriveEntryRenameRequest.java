package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DriveEntryRenameRequest(
        @NotBlank(message = "이름은 필수입니다.")
        @Size(max = 255, message = "이름은 255자 이하여야 합니다.")
        String name
) {
}
