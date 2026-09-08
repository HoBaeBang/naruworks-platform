package com.naruworks.core.service;

import com.naruworks.core.port.CalendarDayMetadataReader;
import com.naruworks.domain.value.CalendarDayMetadata;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CalendarDayMetadataService {

    private final CalendarDayMetadataReader calendarDayMetadataReader;

    /** 요청한 날짜 범위의 공통 달력 정보를 조회한다. */
    public List<CalendarDayMetadata> findBetween(LocalDate from, LocalDate to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException("조회 시작일과 종료일은 필수입니다.");
        }

        if (from.isAfter(to)) {
            throw new IllegalArgumentException("조회 시작일은 종료일보다 늦을 수 없습니다.");
        }

        return calendarDayMetadataReader.findBetween(from, to);
    }
}
