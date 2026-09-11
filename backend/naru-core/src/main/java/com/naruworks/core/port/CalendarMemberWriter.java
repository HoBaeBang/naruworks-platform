package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarMember;

public interface CalendarMemberWriter {

    CalendarMember save(CalendarMember calendarMember);
}
