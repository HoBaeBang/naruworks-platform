package com.naruworks.infrastructure.calendar;

import com.github.usingsky.calendar.KoreanLunarCalendar;
import com.naruworks.core.port.LunarCalendarConverter;
import com.naruworks.domain.value.LunarDate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/** 오프라인 한국 음력 변환 라이브러리를 core port로 연결한다. */
@Component
public class KoreanLunarCalendarConverter implements LunarCalendarConverter {

    private final KoreanLunarCalendar lunarCalendar = KoreanLunarCalendar.getInstance();

    @Override
    public synchronized LunarDate toLunarDate(LocalDate solarDate) {
        if (!lunarCalendar.setSolarDate(
                solarDate.getYear(),
                solarDate.getMonthValue(),
                solarDate.getDayOfMonth()
        )) {
            throw new IllegalArgumentException("지원하지 않는 음력 변환 날짜입니다: " + solarDate);
        }

        return LunarDate.of(
                lunarCalendar.getLunarMonth(),
                lunarCalendar.getLunarDay(),
                lunarCalendar.isIntercalation()
        );
    }

    @Override
    public synchronized LocalDate toSolarDate(int lunarYear, int lunarMonth, int lunarDay) {
        if (lunarCalendar.setLunarDate(lunarYear, lunarMonth, lunarDay, false)) {
            return currentSolarDate();
        }

        if (lunarDay == 30 && lunarCalendar.setLunarDate(lunarYear, lunarMonth, 29, false)) {
            return currentSolarDate();
        }

        throw new IllegalArgumentException("지원하지 않는 음력 반복 날짜입니다.");
    }

    private LocalDate currentSolarDate() {
        return LocalDate.of(
                lunarCalendar.getSolarYear(),
                lunarCalendar.getSolarMonth(),
                lunarCalendar.getSolarDay()
        );
    }
}
