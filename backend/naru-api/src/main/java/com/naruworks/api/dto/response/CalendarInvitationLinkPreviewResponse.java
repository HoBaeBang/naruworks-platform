package com.naruworks.api.dto.response;

import com.naruworks.core.model.CalendarInvitationLinkPreview;
import com.naruworks.domain.type.CalendarMemberRole;
import java.time.LocalDateTime;

public record CalendarInvitationLinkPreviewResponse(
        Long calendarId, String calendarName, String ownerDisplayName,
        CalendarMemberRole role, LocalDateTime expiresAt
) {
    public static CalendarInvitationLinkPreviewResponse from(CalendarInvitationLinkPreview preview) {
        return new CalendarInvitationLinkPreviewResponse(preview.calendarId(), preview.calendarName(),
                preview.ownerDisplayName(), preview.role(), preview.expiresAt());
    }
}
