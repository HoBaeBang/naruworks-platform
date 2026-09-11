package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CalendarCreateRequest(
        @NotBlank(message = "캘린더 이름은 필수입니다.")
        @Size(max = 100, message = "캘린더 이름은 100자 이하여야 합니다.")
        String name
) {
}
