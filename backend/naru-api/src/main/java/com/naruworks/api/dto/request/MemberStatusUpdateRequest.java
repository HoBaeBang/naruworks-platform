package com.naruworks.api.dto.request;

import com.naruworks.domain.type.MemberStatus;
import jakarta.validation.constraints.NotNull;

public record MemberStatusUpdateRequest(
        @NotNull
        MemberStatus status
) {
}
