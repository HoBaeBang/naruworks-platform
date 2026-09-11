package com.naruworks.api.dto.request;

import com.naruworks.domain.type.CalendarMemberRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;

public record CalendarMemberCreateRequest(
        @Email(message = "올바른 이메일 주소를 입력해주세요.")
        String email,
        @NotNull(message = "캘린더 권한은 필수입니다.")
        CalendarMemberRole role
) {
}
