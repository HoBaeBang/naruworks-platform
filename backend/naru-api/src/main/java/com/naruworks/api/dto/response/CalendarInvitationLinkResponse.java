package com.naruworks.api.dto.response;

import java.time.LocalDateTime;

public record CalendarInvitationLinkResponse(String inviteUrl, LocalDateTime expiresAt) {
}
