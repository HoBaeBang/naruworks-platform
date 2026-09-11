package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarMember;
import java.util.List;
import java.util.Optional;

public interface CalendarMemberReader {

    List<CalendarMember> findAllByMemberId(Long memberId);

    Optional<CalendarMember> findByCalendarIdAndMemberId(Long calendarId, Long memberId);
}
