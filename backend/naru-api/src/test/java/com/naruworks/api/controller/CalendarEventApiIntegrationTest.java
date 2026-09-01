package com.naruworks.api.controller;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import com.naruworks.domain.value.ReferralCode;
import com.naruworks.infrastructure.persistence.calendar.CalendarEventEntity;
import com.naruworks.infrastructure.persistence.calendar.CalendarEventJpaRepository;
import com.naruworks.infrastructure.persistence.member.MemberEntity;
import com.naruworks.infrastructure.persistence.member.MemberJpaRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;

@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureMockMvc
class CalendarEventApiIntegrationTest {

    private static final String MEMBER_A_PROVIDER_USER_ID = "google-member-a";

    @Autowired
    private MemberJpaRepository memberJpaRepository;

    private Long memberAId;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private CalendarEventJpaRepository calendarEventJpaRepository;

    @BeforeEach
    void setUp() {
        calendarEventJpaRepository.deleteAll();
        memberJpaRepository.deleteAll();

        Member memberA = Member.createApprovedInitialAdminGoogleMember(
                "member-a@example.com",
                "Member A",
                null,
                MEMBER_A_PROVIDER_USER_ID,
                ReferralCode.of("ADMIN1"),
                LocalDateTime.of(2026, 7, 1, 0, 0)
        );

        memberAId = memberJpaRepository.save(MemberEntity.from(memberA)).getId();

        calendarEventJpaRepository.save(CalendarEventEntity.of(
                memberAId,
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
                memberAId,
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
                memberAId,
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
                        .param("to", "2026-08-01T00:00:00")
                        .with(memberAAuthentication()))
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

    @Test
    @DisplayName("캘린더 일정 생성 API는 일정을 저장하고 생성된 일정을 반환한다")
    void createCalendarEvent() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/calendar/events")
                        .contentType("application/json")
                        .content("""
                            {
                              "title": "운동",
                              "description": "저녁 러닝",
                              "startAt": "2026-07-24T19:00:00",
                              "endAt": "2026-07-24T20:00:00",
                              "allDay": false,
                              "location": "한강공원",
                              "color": "#20b977",
                              "recurrenceRule": "NONE",
                              "recurrenceEndAt": null
                            }
                            """)
                        .with(memberAAuthentication()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("운동"))
                .andExpect(jsonPath("$.description").value("저녁 러닝"))
                .andExpect(jsonPath("$.startAt").value("2026-07-24T19:00:00"))
                .andExpect(jsonPath("$.endAt").value("2026-07-24T20:00:00"))
                .andExpect(jsonPath("$.allDay").value(false))
                .andExpect(jsonPath("$.location").value("한강공원"))
                .andExpect(jsonPath("$.color").value("#20b977"))
                .andExpect(jsonPath("$.recurrenceRule").value("NONE"))
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        assertThat(calendarEventJpaRepository.findAll())
                .extracting(CalendarEventEntity::getTitle)
                .contains("운동");
    }

    @Test
    @DisplayName("캘린더 일정 생성 API는 제목이 비어 있으면 400을 반환한다")
    void createCalendarEventWithBlankTitle() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/calendar/events")
                        .contentType("application/json")
                        .content("""
                        {
                          "title": "",
                          "description": "저녁 러닝",
                          "startAt": "2026-07-24T19:00:00",
                          "endAt": "2026-07-24T20:00:00",
                          "allDay": false,
                          "location": "한강공원",
                          "color": "#20b977",
                          "recurrenceRule": "NONE",
                          "recurrenceEndAt": null
                        }
                        """)
                        .with(memberAAuthentication()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("캘린더 일정 생성 API는 시작 일시가 종료 일시보다 늦으면 400을 반환한다")
    void createCalendarEventWithInvalidPeriod() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.post("/api/calendar/events")
                        .contentType("application/json")
                        .content("""
                        {
                          "title": "운동",
                          "description": "저녁 러닝",
                          "startAt": "2026-07-24T21:00:00",
                          "endAt": "2026-07-24T20:00:00",
                          "allDay": false,
                          "location": "한강공원",
                          "color": "#20b977",
                          "recurrenceRule": "NONE",
                          "recurrenceEndAt": null
                        }
                        """)
                        .with(memberAAuthentication()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("캘린더 일정 단건 조회 API는 id에 해당하는 일정을 반환한다")
    void getCalendarEvent() throws Exception {
        CalendarEventEntity event = calendarEventJpaRepository.save(CalendarEventEntity.of(
                memberAId,
                "단건 조회 일정",
                "단건 조회 테스트",
                LocalDateTime.of(2026, 7, 24, 9, 0),
                LocalDateTime.of(2026, 7, 24, 10, 0),
                false,
                "집",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        mockMvc.perform(MockMvcRequestBuilders.get("/api/calendar/events/{id}", event.getId())
                        .with(memberAAuthentication()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(event.getId()))
                .andExpect(jsonPath("$.title").value("단건 조회 일정"))
                .andExpect(jsonPath("$.description").value("단건 조회 테스트"))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    @DisplayName("캘린더 일정 단건 조회 API는 일정이 없으면 404를 반환한다")
    void getCalendarEventNotFound() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/calendar/events/{id}", 999999L)
                        .with(memberAAuthentication()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("일정을 찾을 수 없습니다."));
    }

    @Test
    @DisplayName("캘린더 일정 수정 API는 일정을 수정하고 수정된 일정을 반환한다")
    void updateCalendarEvent() throws Exception {
        CalendarEventEntity event = calendarEventJpaRepository.save(CalendarEventEntity.of(
                memberAId,
                "수정 전 일정",
                "수정 전 설명",
                LocalDateTime.of(2026, 7, 24, 9, 0),
                LocalDateTime.of(2026, 7, 24, 10, 0),
                false,
                "집",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        mockMvc.perform(MockMvcRequestBuilders.put("/api/calendar/events/{id}", event.getId())
                        .contentType("application/json")
                        .content("""
                        {
                          "title": "수정된 일정",
                          "description": "수정된 설명",
                          "startAt": "2026-07-24T11:00:00",
                          "endAt": "2026-07-24T12:00:00",
                          "allDay": false,
                          "location": "카페",
                          "color": "#57df9a",
                          "recurrenceRule": "NONE",
                          "recurrenceEndAt": null
                        }
                        """)
                        .with(memberAAuthentication()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(event.getId()))
                .andExpect(jsonPath("$.title").value("수정된 일정"))
                .andExpect(jsonPath("$.description").value("수정된 설명"))
                .andExpect(jsonPath("$.location").value("카페"))
                .andExpect(jsonPath("$.color").value("#57df9a"));
    }

    @Test
    @DisplayName("캘린더 일정 수정 API는 일정이 없으면 404를 반환한다")
    void updateCalendarEventNotFound() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.put("/api/calendar/events/{id}", 999999L)
                        .contentType("application/json")
                        .content("""
                        {
                          "title": "수정된 일정",
                          "description": "수정된 설명",
                          "startAt": "2026-07-24T11:00:00",
                          "endAt": "2026-07-24T12:00:00",
                          "allDay": false,
                          "location": "카페",
                          "color": "#57df9a",
                          "recurrenceRule": "NONE",
                          "recurrenceEndAt": null
                        }
                        """)
                        .with(memberAAuthentication()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("일정을 찾을 수 없습니다."));
    }

    @Test
    @DisplayName("캘린더 일정 삭제 API는 일정을 삭제하고 204를 반환한다")
    void deleteCalendarEvent() throws Exception {
        CalendarEventEntity event = calendarEventJpaRepository.save(CalendarEventEntity.of(
                memberAId,
                "삭제할 일정",
                "삭제 테스트",
                LocalDateTime.of(2026, 7, 24, 9, 0),
                LocalDateTime.of(2026, 7, 24, 10, 0),
                false,
                "집",
                "#20b977",
                CalendarEventRecurrenceRule.NONE,
                null,
                CalendarEventStatus.ACTIVE
        ));

        mockMvc.perform(MockMvcRequestBuilders.delete("/api/calendar/events/{id}", event.getId())
                        .with(memberAAuthentication()))
                .andExpect(status().isNoContent());

        assertThat(calendarEventJpaRepository.findById(event.getId())).isEmpty();
    }

    @Test
    @DisplayName("캘린더 일정 삭제 API는 일정이 없으면 404를 반환한다")
    void deleteCalendarEventNotFound() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.delete("/api/calendar/events/{id}", 999999L)
                        .with(memberAAuthentication()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("일정을 찾을 수 없습니다."));
    }

    private RequestPostProcessor memberAAuthentication() {
        return oauth2Login().attributes(attributes ->
                attributes.put("sub", MEMBER_A_PROVIDER_USER_ID)
        );
    }
}
