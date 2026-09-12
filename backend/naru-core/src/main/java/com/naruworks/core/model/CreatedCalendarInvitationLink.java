package com.naruworks.core.model;

import java.time.LocalDateTime;

public record CreatedCalendarInvitationLink(String token, LocalDateTime expiresAt) {
}
