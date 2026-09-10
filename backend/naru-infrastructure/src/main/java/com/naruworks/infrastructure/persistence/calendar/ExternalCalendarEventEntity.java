package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.ExternalCalendarEvent;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(
        name = "external_calendar_events",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_external_calendar_events_calendar_event",
                columnNames = {"calendar_integration_calendar_id", "provider_event_id"}
        )
)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ExternalCalendarEventEntity {

    /** 외부 일정 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 이 일정을 제공한 선택 Google 캘린더 식별자 */
    @Column(name = "calendar_integration_calendar_id", nullable = false)
    private Long calendarIntegrationCalendarId;

    /** Google Calendar API 기준 이벤트 식별자 */
    @Column(name = "provider_event_id", nullable = false, length = 1024)
    private String providerEventId;

    /** 외부 일정 제목 */
    @Column(nullable = false, length = 255)
    private String title;

    /** 외부 일정 설명 */
    @Column(columnDefinition = "TEXT")
    private String description;

    /** 외부 일정 시작 일시 */
    @Column(name = "start_at", nullable = false)
    private LocalDateTime startAt;

    /** 외부 일정 종료 일시 */
    @Column(name = "end_at", nullable = false)
    private LocalDateTime endAt;

    /** 종일 일정 여부 */
    @Column(name = "all_day", nullable = false)
    private boolean allDay;

    /** 외부 일정 장소 */
    @Column(length = 500)
    private String location;

    /** Google이 반환한 일정 또는 캘린더 색상 */
    @Column(length = 20)
    private String color;

    /** Google 원본 일정 마지막 수정 시각 */
    @Column(name = "provider_updated_at")
    private LocalDateTime providerUpdatedAt;

    /** NaruWorks 저장 시각 */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** NaruWorks 마지막 갱신 시각 */
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static ExternalCalendarEventEntity from(ExternalCalendarEvent event) {
        ExternalCalendarEventEntity entity = new ExternalCalendarEventEntity();
        entity.id = event.getId();
        entity.calendarIntegrationCalendarId = event.getCalendarIntegrationCalendarId();
        entity.providerEventId = event.getProviderEventId();
        entity.title = event.getTitle();
        entity.description = event.getDescription();
        entity.startAt = event.getStartAt();
        entity.endAt = event.getEndAt();
        entity.allDay = event.isAllDay();
        entity.location = event.getLocation();
        entity.color = event.getColor();
        entity.providerUpdatedAt = event.getProviderUpdatedAt();
        entity.createdAt = event.getCreatedAt();
        entity.updatedAt = event.getUpdatedAt();
        return entity;
    }

    public ExternalCalendarEvent toDomain() {
        return ExternalCalendarEvent.builder()
                .id(id)
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
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }
}
