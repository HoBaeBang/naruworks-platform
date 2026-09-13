package com.naruworks.api.dto.request;

import com.naruworks.domain.type.CalendarMemberRole;
import jakarta.validation.constraints.NotNull;

/** OWNER가 공유 캘린더 참여자에게 부여할 권한 */
public record CalendarMemberRoleUpdateRequest(
        @NotNull(message = "캘린더 권한은 필수입니다.")
        CalendarMemberRole role
) {
}
