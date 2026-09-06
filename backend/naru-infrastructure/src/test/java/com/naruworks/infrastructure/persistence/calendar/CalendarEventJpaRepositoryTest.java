package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import com.naruworks.infrastructure.InfrastructureTestApplication;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import(InfrastructureTestApplication.class)
class CalendarEventJpaRepositoryTest {

    private static final Long MEMBER_A_ID = 1L;

    @Autowired
    private CalendarEventJpaRepository calendarEventJpaRepository;

    @Test
    @DisplayName("조회 기간에 표시할 단일 일정과 반복 일정 원본을 조회한다")
    void findDisplayCandidates() {
        LocalDateTime from = LocalDateTime.of(2026, 7, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 8, 1, 0, 0);

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                MEMBER_A_ID,
                "6월부터 이어지는 일정",
                "조회 시작일보다 먼저 시작하지만 기간과 겹치는 일정",
                LocalDateTime.of(2026, 6, 30, 10, 0),
                LocalDateTime.of(2026, 7, 1, 10, 0),
                false,
                "서울",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                MEMBER_A_ID,
                "6월부터 반복되는 운동",
                "원본은 조회 기간 전이지만 반복 발생 건은 기간 안에 있음",
                LocalDateTime.of(2026, 6, 5, 19, 0),
                LocalDateTime.of(2026, 6, 5, 20, 0),
                false,
                "한강공원",
                "#20b977",
                CalendarEventRecurrenceRule.WEEKLY,
                null,
                CalendarEventStatus.ACTIVE
        ));

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                MEMBER_A_ID,
                "7월 일정",
                "조회 기간 안에 들어오는 일정",
                LocalDateTime.of(2026, 7, 10, 9, 0),
                LocalDateTime.of(2026, 7, 10, 10, 0),
                false,
                "집",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                MEMBER_A_ID,
                "8월까지 이어지는 일정",
                "조회 종료일 이후까지 이어지는 일정",
                LocalDateTime.of(2026, 7, 31, 23, 0),
                LocalDateTime.of(2026, 8, 1, 1, 0),
                false,
                "카페",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                MEMBER_A_ID,
                "조회 범위 밖 일정",
                "조회 기간과 겹치지 않는 일정",
                LocalDateTime.of(2026, 8, 2, 9, 0),
                LocalDateTime.of(2026, 8, 2, 10, 0),
                false,
                "회사",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        List<CalendarEventEntity> events =
                calendarEventJpaRepository.findDisplayCandidates(
                        MEMBER_A_ID,
                        from,
                        to,
                        CalendarEventRecurrenceRule.NONE,
                        CalendarEventStatus.ACTIVE
                );

        assertThat(events)
                .extracting(CalendarEventEntity::getTitle)
                .containsExactly(
                        "6월부터 반복되는 운동",
                        "6월부터 이어지는 일정",
                        "7월 일정",
                        "8월까지 이어지는 일정"
                );
    }
}
