package com.naruworks.core.service;

import com.naruworks.core.port.CalendarDayMetadataReader;
import com.naruworks.domain.value.CalendarDayMetadata;
import com.naruworks.domain.value.LunarDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

@ExtendWith(MockitoExtension.class)
class CalendarDayMetadataServiceTest {

    @Mock
    private CalendarDayMetadataReader calendarDayMetadataReader;

    @Test
    @DisplayName("요청한 날짜 범위의 달력 메타데이터를 조회한다")
    void findBetween() {
        LocalDate from = LocalDate.of(2026, 3, 1);
        LocalDate to = LocalDate.of(2026, 3, 2);
        List<CalendarDayMetadata> expected = List.of(
                CalendarDayMetadata.of(from, LunarDate.of(1, 13, false), "삼일절")
        );
        given(calendarDayMetadataReader.findBetween(from, to)).willReturn(expected);

        List<CalendarDayMetadata> result = service().findBetween(from, to);

        assertThat(result).isEqualTo(expected);
        then(calendarDayMetadataReader).should().findBetween(from, to);
    }

    @Test
    @DisplayName("시작일이 종료일보다 늦으면 조회하지 않는다")
    void findBetween_rejectsInvertedDateRange() {
        assertThatThrownBy(() -> service().findBetween(
                LocalDate.of(2026, 3, 2),
                LocalDate.of(2026, 3, 1)
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("조회 시작일은 종료일보다 늦을 수 없습니다.");

        then(calendarDayMetadataReader).shouldHaveNoInteractions();
    }

    private CalendarDayMetadataService service() {
        return new CalendarDayMetadataService(calendarDayMetadataReader);
    }
}
