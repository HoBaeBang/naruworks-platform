package com.naruworks.core.port;

import com.naruworks.domain.model.Calendar;
import java.util.Optional;

public interface CalendarReader {

    Optional<Calendar> findPersonalByOwnerMemberId(Long memberId);

    Optional<Calendar> findById(Long calendarId);
}
