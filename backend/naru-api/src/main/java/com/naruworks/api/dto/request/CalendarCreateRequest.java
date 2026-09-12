package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CalendarCreateRequest(
        @NotBlank(message = "캘린더 이름은 필수입니다.")
        @Size(max = 100, message = "캘린더 이름은 100자 이하여야 합니다.")
        String name,
        boolean shared,
        @NotBlank(message = "캘린더 색상은 필수입니다.")
        @Size(max = 20, message = "캘린더 색상 값이 너무 깁니다.")
        String displayColor
) {
}
