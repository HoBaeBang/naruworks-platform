package com.naruworks.api.dto.request;

import jakarta.validation.constraints.NotBlank;

public record CalendarInvitationLinkAcceptRequest(@NotBlank String token) {
}
