package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarInvitationLink;

public interface CalendarInvitationLinkWriter {

    CalendarInvitationLink save(CalendarInvitationLink invitationLink);

    void revokeActiveByCalendarId(Long calendarId);
}
