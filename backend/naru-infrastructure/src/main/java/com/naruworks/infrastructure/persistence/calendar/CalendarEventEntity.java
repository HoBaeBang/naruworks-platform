package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarEvent;
import com.naruworks.domain.type.CalendarEventRecurrenceRule;
import com.naruworks.domain.type.CalendarEventStatus;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Getter
@Entity
@Table(name = "calendar_events")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 일정을 소유한 회원의 내부 식별자 */
    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** 일정 제목 */
    @Column(nullable = false, length = 100)
    private String title;

    /** 일정 설명 */
    @Column(columnDefinition = "TEXT")
    private String description;

    /** 일정 시작 일시 */
    @Column(nullable = false)
    private LocalDateTime startAt;

    /** 일정 종료 일시 */
    @Column(nullable = false)
    private LocalDateTime endAt;

    /** 하루 종일 일정 여부 */
    @Column(nullable = false)
    private boolean allDay;

    /** 일정 장소 */
    @Column(length = 255)
    private String location;

    /** 화면에 표시할 일정 색상 */
    @Column(nullable = false, length = 20)
    private String color;

    /** 반복 일정 규칙 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CalendarEventRecurrenceRule recurrenceRule;

    /** 반복 일정 종료 일시 */
    private LocalDateTime recurrenceEndAt;

    /** 일정 상태 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CalendarEventStatus status;

    /** 생성 시각 */
    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** 수정 시각 */
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    public CalendarEvent toDomain() {
        return CalendarEvent.of(
                id,
                memberId,
                title,
                description,
                startAt,
                endAt,
                allDay,
                location,
                color,
                recurrenceRule,
                recurrenceEndAt,
                status
        );
    }

    public static CalendarEventEntity of(
            Long memberId,
            String title,
            String description,
            LocalDateTime startAt,
            LocalDateTime endAt,
            boolean allDay,
            String location,
            String color,
            CalendarEventRecurrenceRule recurrenceRule,
            LocalDateTime recurrenceEndAt,
            CalendarEventStatus status
    ) {
        CalendarEventEntity entity = new CalendarEventEntity();
        entity.memberId = memberId;
        entity.title = title;
        entity.description = description;
        entity.startAt = startAt;
        entity.endAt = endAt;
        entity.allDay = allDay;
        entity.location = location;
        entity.color = color;
        entity.recurrenceRule = recurrenceRule;
        entity.recurrenceEndAt = recurrenceEndAt;
        entity.status = status;
        entity.createdAt = LocalDateTime.now();
        entity.updatedAt = LocalDateTime.now();
        return entity;
    }

    public static CalendarEventEntity from(CalendarEvent event) {
        return CalendarEventEntity.of(
                event.getMemberId(),
                event.getTitle(),
                event.getDescription(),
                event.getStartAt(),
                event.getEndAt(),
                event.isAllDay(),
                event.getLocation(),
                event.getColor(),
                event.getRecurrenceRule(),
                event.getRecurrenceEndAt(),
                event.getStatus()
        );
    }

    public void update(CalendarEvent event) {
        this.title = event.getTitle();
        this.description = event.getDescription();
        this.startAt = event.getStartAt();
        this.endAt = event.getEndAt();
        this.allDay = event.isAllDay();
        this.location = event.getLocation();
        this.color = event.getColor();
        this.recurrenceRule = event.getRecurrenceRule();
        this.recurrenceEndAt = event.getRecurrenceEndAt();
        this.status = event.getStatus();
        this.updatedAt = LocalDateTime.now();
    }
}
