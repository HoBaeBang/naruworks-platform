package com.naruworks.api.dto.request;

import com.naruworks.domain.type.CalendarMemberRole;
import jakarta.validation.constraints.NotNull;

public record CalendarInvitationLinkCreateRequest(@NotNull CalendarMemberRole role) {
}
