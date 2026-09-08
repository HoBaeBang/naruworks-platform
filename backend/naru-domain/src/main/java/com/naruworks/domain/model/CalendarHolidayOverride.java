package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarHolidayOverrideOperation;
import lombok.Builder;

import java.time.LocalDate;

/** 운영자가 DB로 직접 등록하는 공휴일 추가 또는 제외 예외다. */
@Builder
public record CalendarHolidayOverride(
        Long id,
        LocalDate holidayDate,
        CalendarHolidayOverrideOperation operation,
        String holidayName,
        String reason
) {

    public CalendarHolidayOverride {
        if (holidayDate == null || operation == null) {
            throw new IllegalArgumentException("공휴일 예외 날짜와 작업은 필수입니다.");
        }

        if (operation == CalendarHolidayOverrideOperation.ADD
                && (holidayName == null || holidayName.isBlank())) {
            throw new IllegalArgumentException("공휴일 추가 예외에는 이름이 필요합니다.");
        }
    }

    public static CalendarHolidayOverride of(
            Long id,
            LocalDate holidayDate,
            CalendarHolidayOverrideOperation operation,
            String holidayName,
            String reason
    ) {
        return new CalendarHolidayOverride(id, holidayDate, operation, holidayName, reason);
    }
}
