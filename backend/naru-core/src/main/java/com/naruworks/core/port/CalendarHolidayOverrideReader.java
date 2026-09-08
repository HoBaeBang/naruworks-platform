package com.naruworks.core.port;

import com.naruworks.domain.model.CalendarHolidayOverride;

import java.time.LocalDate;
import java.util.List;

/** 법정공휴일 계산 결과에 반영할 운영상 날짜 예외를 읽는다. */
public interface CalendarHolidayOverrideReader {

    List<CalendarHolidayOverride> findAllBetween(LocalDate from, LocalDate to);
}
