package com.naruworks.core.port;

import com.naruworks.core.model.GoogleCalendarAccount;
import com.naruworks.core.model.GoogleCalendar;
import com.naruworks.core.model.GoogleCalendarOAuthToken;
import java.util.List;

public interface GoogleCalendarOAuthClient {

    String createAuthorizationUrl(String state);

    GoogleCalendarOAuthToken exchangeAuthorizationCode(String authorizationCode);

    GoogleCalendarAccount findAccount(String accessToken);

    String refreshAccessToken(String refreshToken);

    List<GoogleCalendar> findCalendars(String accessToken);
}
