package com.naruworks.core.port;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendarOAuthToken;

public interface GoogleCalendarOAuthClient {

    String createAuthorizationUrl(String state);

    GoogleCalendarOAuthToken exchangeAuthorizationCode(String authorizationCode);

    GoogleCalendarAccount findAccount(String accessToken);
}
