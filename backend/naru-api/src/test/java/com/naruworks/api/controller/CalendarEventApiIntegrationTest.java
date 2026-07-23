package com.naruworks.api.controller;

import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import com.naruworks.infrastructure.persistence.calendar.CalendarEventEntity;
import com.naruworks.infrastructure.persistence.calendar.CalendarEventJpaRepository;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureMockMvc
class CalendarEventApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private CalendarEventJpaRepository calendarEventJpaRepository;

    @BeforeEach
    void setUp() {
        calendarEventJpaRepository.deleteAll();

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                "7월 첫 일정",
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
                "7월 말 일정",
                "조회 종료일 이후까지 이어지는 일정",
                LocalDateTime.of(2026, 7, 31, 23, 0),
                LocalDateTime.of(2026, 8, 1, 1, 0),
                false,
                "카페",
                "#57df9a",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        calendarEventJpaRepository.save(CalendarEventEntity.of(
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
    }

    @Test
    @DisplayName("캘린더 일정 목록 API는 조회 기간과 겹치는 일정을 시작일 오름차순으로 반환한다")
    void getCalendarEvents() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/calendar/events")
                        .param("from", "2026-07-01T00:00:00")
                        .param("to", "2026-08-01T00:00:00"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("7월 첫 일정"))
                .andExpect(jsonPath("$[0].startAt").value("2026-07-10T09:00:00"))
                .andExpect(jsonPath("$[0].endAt").value("2026-07-10T10:00:00"))
                .andExpect(jsonPath("$[0].allDay").value(false))
                .andExpect(jsonPath("$[0].location").value("집"))
                .andExpect(jsonPath("$[0].color").value("#20b977"))
                .andExpect(jsonPath("$[0].recurrenceRule").value("NONE"))
                .andExpect(jsonPath("$[0].status").value("ACTIVE"))
                .andExpect(jsonPath("$[1].title").value("7월 말 일정"))
                .andExpect(jsonPath("$[1].startAt").value("2026-07-31T23:00:00"))
                .andExpect(jsonPath("$[1].location").value("카페"))
                .andExpect(jsonPath("$[2]").doesNotExist());
    }
}
