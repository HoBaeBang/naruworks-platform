package com.naruworks.infrastructure.calendar;

import com.naruworks.domain.value.CalendarDayMetadata;
import com.naruworks.domain.model.CalendarHolidayOverride;
import com.naruworks.domain.type.CalendarHolidayOverrideOperation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KoreanCalendarMetadataAdapterTest {

    private final KoreanLunarCalendarConverter lunarCalendarConverter = new KoreanLunarCalendarConverter();

    private KoreanCalendarMetadataAdapter adapter() {
        return new KoreanCalendarMetadataAdapter(lunarCalendarConverter, (from, to) -> List.of());
    }

    @Test
    @DisplayName("삼일절을 공휴일로 반환하고 음력 날짜를 함께 제공한다")
    void findBetween_includesIndependenceMovementDay() {
        List<CalendarDayMetadata> result = adapter().findBetween(
                LocalDate.of(2026, 3, 1),
                LocalDate.of(2026, 3, 1)
        );

        assertThat(result).singleElement().satisfies(metadata -> {
            assertThat(metadata.holidayName()).isEqualTo("삼일절");
            assertThat(metadata.lunarDate().month()).isBetween(1, 12);
            assertThat(metadata.lunarDate().day()).isBetween(1, 30);
        });
    }

    @Test
    @DisplayName("2026년 부처님오신날의 일요일은 다음 평일 대체공휴일로 계산한다")
    void findBetween_includesSubstituteHoliday() {
        List<CalendarDayMetadata> result = adapter().findBetween(
                LocalDate.of(2026, 5, 24),
                LocalDate.of(2026, 5, 25)
        );

        assertThat(result)
                .extracting(CalendarDayMetadata::holidayName)
                .containsExactly("부처님오신날", "대체공휴일");
    }

    @Test
    @DisplayName("DB 추가 공휴일 예외는 기본 계산 결과보다 우선한다")
    void findBetween_appliesAddedHolidayOverride() {
        KoreanCalendarMetadataAdapter adapter = new KoreanCalendarMetadataAdapter(
                lunarCalendarConverter,
                (from, to) -> List.of(CalendarHolidayOverride.of(
                        1L,
                        LocalDate.of(2026, 7, 17),
                        CalendarHolidayOverrideOperation.ADD,
                        "임시공휴일",
                        "운영 등록"
                ))
        );

        List<CalendarDayMetadata> result = adapter.findBetween(
                LocalDate.of(2026, 7, 17),
                LocalDate.of(2026, 7, 17)
        );

        assertThat(result).singleElement()
                .extracting(CalendarDayMetadata::holidayName)
                .isEqualTo("임시공휴일");
    }

    @Test
    @DisplayName("DB 제외 공휴일 예외는 기본 계산 결과에서 날짜를 제거한다")
    void findBetween_appliesRemovedHolidayOverride() {
        KoreanCalendarMetadataAdapter adapter = new KoreanCalendarMetadataAdapter(
                lunarCalendarConverter,
                (from, to) -> List.of(CalendarHolidayOverride.of(
                        1L,
                        LocalDate.of(2026, 3, 1),
                        CalendarHolidayOverrideOperation.REMOVE,
                        null,
                        "운영 제외"
                ))
        );

        List<CalendarDayMetadata> result = adapter.findBetween(
                LocalDate.of(2026, 3, 1),
                LocalDate.of(2026, 3, 1)
        );

        assertThat(result).singleElement()
                .extracting(CalendarDayMetadata::holidayName)
                .isNull();
    }
}
