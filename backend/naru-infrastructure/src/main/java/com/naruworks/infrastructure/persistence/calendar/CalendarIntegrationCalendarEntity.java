package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarIntegrationCalendar;
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
        name = "calendar_integration_calendars",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_calendar_integration_calendars_integration_calendar",
                columnNames = {"calendar_integration_id", "provider_calendar_id"}
        )
)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarIntegrationCalendarEntity {

    /** 외부 캘린더 선택 설정의 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 이 캘린더를 소유한 외부 계정 연결 식별자 */
    @Column(name = "calendar_integration_id", nullable = false)
    private Long calendarIntegrationId;

    /** Google Calendar API가 부여한 캘린더 식별자 */
    @Column(name = "provider_calendar_id", nullable = false, length = 500)
    private String providerCalendarId;

    /** 제공자가 반환한 캘린더 표시 이름 */
    @Column(name = "calendar_name", nullable = false, length = 255)
    private String calendarName;

    /** 제공자가 반환한 캘린더 색상 */
    @Column(name = "calendar_color", length = 20)
    private String calendarColor;

    /** NaruWorks 화면에 이 캘린더를 표시할지 여부 */
    @Column(nullable = false)
    private boolean enabled;

    /** 이 캘린더의 마지막 외부 일정 동기화 시각 */
    @Column(name = "last_synced_at")
    private LocalDateTime lastSyncedAt;

    /** 이 캘린더의 Google 증분 동기화용 token */
    @Column(name = "sync_token", columnDefinition = "TEXT")
    private String syncToken;

    /** 선택 설정 생성 시각 */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** 선택 설정 마지막 수정 시각 */
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static CalendarIntegrationCalendarEntity from(CalendarIntegrationCalendar calendar) {
        CalendarIntegrationCalendarEntity entity = new CalendarIntegrationCalendarEntity();
        entity.id = calendar.getId();
        entity.calendarIntegrationId = calendar.getCalendarIntegrationId();
        entity.providerCalendarId = calendar.getProviderCalendarId();
        entity.calendarName = calendar.getCalendarName();
        entity.calendarColor = calendar.getCalendarColor();
        entity.enabled = calendar.isEnabled();
        entity.lastSyncedAt = calendar.getLastSyncedAt();
        entity.syncToken = calendar.getSyncToken();
        entity.createdAt = calendar.getCreatedAt();
        entity.updatedAt = calendar.getUpdatedAt();
        return entity;
    }

    public CalendarIntegrationCalendar toDomain() {
        return CalendarIntegrationCalendar.builder()
                .id(id)
                .calendarIntegrationId(calendarIntegrationId)
                .providerCalendarId(providerCalendarId)
                .calendarName(calendarName)
                .calendarColor(calendarColor)
                .enabled(enabled)
                .lastSyncedAt(lastSyncedAt)
                .syncToken(syncToken)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }
}
