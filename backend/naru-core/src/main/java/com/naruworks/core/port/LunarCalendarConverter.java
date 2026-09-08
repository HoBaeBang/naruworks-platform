package com.naruworks.core.port;

import com.naruworks.domain.value.LunarDate;

import java.time.LocalDate;

/** 한국 음력과 양력의 변환을 제공하는 외부 의존성 경계다. */
public interface LunarCalendarConverter {

    LunarDate toLunarDate(LocalDate solarDate);

    /** 평달 기준의 음력 월·일을 지정 연도의 양력 날짜로 변환한다. */
    LocalDate toSolarDate(int lunarYear, int lunarMonth, int lunarDay);
}
