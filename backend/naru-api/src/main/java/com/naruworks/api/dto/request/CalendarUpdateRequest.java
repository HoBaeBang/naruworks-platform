package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** OWNER가 변경할 수 있는 캘린더 표시 정보 */
public record CalendarUpdateRequest(
        @NotBlank(message = "캘린더 이름은 필수입니다.")
        @Size(max = 100, message = "캘린더 이름은 100자 이하여야 합니다.")
        String name,
        @NotBlank(message = "캘린더 색상은 필수입니다.")
        @Size(max = 20, message = "캘린더 색상 값이 너무 깁니다.")
        String displayColor
) {
}
