package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotNull;

/** 공유 캘린더의 새 OWNER가 될 기존 참여 회원 식별자 */
public record CalendarOwnershipTransferRequest(
        @NotNull(message = "새 소유자는 필수입니다.")
        Long memberId
) {
}
