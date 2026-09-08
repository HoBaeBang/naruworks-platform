package com.naruworks.domain.value;

import java.time.LocalDate;

/**
 * 특정 양력 날짜에 공통으로 적용되는 음력과 공휴일 정보를 표현한다.
 */
public record CalendarDayMetadata(
        LocalDate date,
        LunarDate lunarDate,
        String holidayName
) {

    public CalendarDayMetadata {
        if (date == null) {
            throw new IllegalArgumentException("날짜는 필수입니다.");
        }

        if (lunarDate == null) {
            throw new IllegalArgumentException("음력 날짜는 필수입니다.");
        }
    }

    public static CalendarDayMetadata of(
            LocalDate date,
            LunarDate lunarDate,
            String holidayName
    ) {
        return new CalendarDayMetadata(date, lunarDate, holidayName);
    }

    public boolean isHoliday() {
        return holidayName != null && !holidayName.isBlank();
    }
}
