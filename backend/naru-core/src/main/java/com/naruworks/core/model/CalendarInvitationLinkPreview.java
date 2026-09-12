package com.naruworks.core.model;

import com.naruworks.domain.type.CalendarMemberRole;
import java.time.LocalDateTime;

public record CalendarInvitationLinkPreview(
        Long calendarId,
        String calendarName,
        String ownerDisplayName,
        CalendarMemberRole role,
        LocalDateTime expiresAt
) {
}
