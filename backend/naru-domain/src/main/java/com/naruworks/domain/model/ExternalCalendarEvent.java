package com.naruworks.domain.model;

import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

/** Google Calendar에서 읽어 온 외부 일정의 저장 모델이다. */
@Getter
@Builder(toBuilder = true)
public class ExternalCalendarEvent {

    private final Long id;
    /** 이 일정을 제공한 선택 Google 캘린더의 내부 식별자 */
    private final Long calendarIntegrationCalendarId;
    /** Google Calendar API 기준 이벤트 식별자 */
    private final String providerEventId;
    /** 외부 일정 제목 */
    private final String title;
    /** 외부 일정 설명 */
    private final String description;
    /** 외부 일정 시작 일시 */
    private final LocalDateTime startAt;
    /** 외부 일정 종료 일시 */
    private final LocalDateTime endAt;
    /** 종일 일정 여부 */
    private final boolean allDay;
    /** 외부 일정 장소 */
    private final String location;
    /** Google이 반환한 일정 색상 */
    private final String color;
    /** Google 원본의 마지막 수정 시각 */
    private final LocalDateTime providerUpdatedAt;
    /** NaruWorks 저장 시각 */
    private final LocalDateTime createdAt;
    /** NaruWorks 마지막 갱신 시각 */
    private final LocalDateTime updatedAt;

    public static ExternalCalendarEvent create(
            Long calendarIntegrationCalendarId,
            String providerEventId,
            String title,
            String description,
            LocalDateTime startAt,
            LocalDateTime endAt,
            boolean allDay,
            String location,
            String color,
            LocalDateTime providerUpdatedAt,
            LocalDateTime now
    ) {
        return ExternalCalendarEvent.builder()
                .calendarIntegrationCalendarId(calendarIntegrationCalendarId)
                .providerEventId(providerEventId)
                .title(title)
                .description(description)
                .startAt(startAt)
                .endAt(endAt)
                .allDay(allDay)
                .location(location)
                .color(color)
                .providerUpdatedAt(providerUpdatedAt)
                .createdAt(now)
                .updatedAt(now)
                .build();
    }

    public ExternalCalendarEvent updateFromProvider(
            String title,
            String description,
            LocalDateTime startAt,
            LocalDateTime endAt,
            boolean allDay,
            String location,
            String color,
            LocalDateTime providerUpdatedAt,
            LocalDateTime now
    ) {
        return toBuilder()
                .title(title)
                .description(description)
                .startAt(startAt)
                .endAt(endAt)
                .allDay(allDay)
                .location(location)
                .color(color)
                .providerUpdatedAt(providerUpdatedAt)
                .updatedAt(now)
                .build();
    }
}
