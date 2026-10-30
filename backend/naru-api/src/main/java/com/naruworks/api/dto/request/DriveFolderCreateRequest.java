package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record DriveFolderCreateRequest(
        @Positive(message = "상위 폴더 ID는 양수여야 합니다.")
        Long parentId,
        @NotBlank(message = "폴더 이름은 필수입니다.")
        @Size(max = 255, message = "폴더 이름은 255자 이하여야 합니다.")
        String name
) {
}
