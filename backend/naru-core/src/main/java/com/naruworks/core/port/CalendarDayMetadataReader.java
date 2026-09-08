package com.naruworks.core.port;

import com.naruworks.domain.value.CalendarDayMetadata;

import java.time.LocalDate;
import java.util.List;

/**
 * 양력 날짜 범위의 한국 달력 메타데이터를 제공하는 외부 의존성 경계다.
 */
public interface CalendarDayMetadataReader {

    List<CalendarDayMetadata> findBetween(LocalDate from, LocalDate to);
}
