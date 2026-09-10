package com.naruworks.api.security;

public final class AuthSessionAttribute {

    public static final String PENDING_REFERRAL_CODE = "naru.pending-referral-code";
    public static final String PENDING_GOOGLE_CALENDAR_OAUTH_STATE =
            "naru.pending-google-calendar-oauth-state";
    public static final String PENDING_GOOGLE_CALENDAR_MEMBER_ID =
            "naru.pending-google-calendar-member-id";

    private AuthSessionAttribute() {
    }
}
