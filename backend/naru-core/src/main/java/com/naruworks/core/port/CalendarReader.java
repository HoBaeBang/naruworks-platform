package com.naruworks.core.port;

import com.naruworks.domain.model.Calendar;
import java.util.List;
import java.util.Optional;

public interface CalendarReader {

    Optional<Calendar> findDefaultByOwnerMemberId(Long memberId);

    Optional<Calendar> findById(Long calendarId);

    List<Calendar> findAllByOwnerMemberId(Long memberId);
}
