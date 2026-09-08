package com.naruworks.api.dto.response;

import com.naruworks.domain.value.CalendarDayMetadata;

import java.time.LocalDate;

public record CalendarDayMetadataResponse(
        LocalDate date,
        int lunarMonth,
        int lunarDay,
        boolean lunarIntercalation,
        String holidayName
) {

    public static CalendarDayMetadataResponse from(CalendarDayMetadata metadata) {
        return new CalendarDayMetadataResponse(
                metadata.date(),
                metadata.lunarDate().month(),
                metadata.lunarDate().day(),
                metadata.lunarDate().intercalation(),
                metadata.holidayName()
        );
    }
}
