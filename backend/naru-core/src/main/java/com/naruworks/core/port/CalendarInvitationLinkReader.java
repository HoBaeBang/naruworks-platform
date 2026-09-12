package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarInvitationLink;
import java.util.Optional;

public interface CalendarInvitationLinkReader {

    Optional<CalendarInvitationLink> findByTokenHash(String tokenHash);
}
