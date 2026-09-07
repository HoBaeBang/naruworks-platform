package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarEventException;
import com.naruworks.domain.type.CalendarEventExceptionType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
        name = "calendar_event_exceptions",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_calendar_event_exceptions_event_occurrence",
                columnNames = {"calendar_event_id", "occurrence_start_at"}
        )
)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarEventExceptionEntity {

    /** 반복 일정 예외의 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 반복 원본 일정의 내부 식별자 */
    @Column(name = "calendar_event_id", nullable = false)
    private Long calendarEventId;

    /** 원본 규칙으로 계산한 예외 대상 회차의 시작 일시 */
    @Column(nullable = false)
    private LocalDateTime occurrenceStartAt;

    /** 특정 회차 취소 또는 상세 값 재정의 여부 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CalendarEventExceptionType exceptionType;

    /** 재정의한 일정 제목 */
    @Column(length = 100)
    private String title;

    /** 재정의한 일정 설명 */
    @Column(columnDefinition = "TEXT")
    private String description;

    /** 재정의한 일정 시작 일시 */
    private LocalDateTime startAt;

    /** 재정의한 일정 종료 일시 */
    private LocalDateTime endAt;

    /** 재정의한 하루 종일 일정 여부 */
    private Boolean allDay;

    /** 재정의한 일정 장소 */
    @Column(length = 255)
    private String location;

    /** 재정의한 일정 표시 색상 */
    @Column(length = 20)
    private String color;

    /** 예외 row가 최초 생성된 시각 */
    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** 예외 row가 마지막 수정된 시각 */
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    public static CalendarEventExceptionEntity from(CalendarEventException exception) {
        CalendarEventExceptionEntity entity = new CalendarEventExceptionEntity();
        entity.calendarEventId = exception.calendarEventId();
        entity.occurrenceStartAt = exception.occurrenceStartAt();
        entity.update(exception);
        entity.createdAt = LocalDateTime.now();
        entity.updatedAt = entity.createdAt;
        return entity;
    }

    public CalendarEventException toDomain() {
        return new CalendarEventException(
                id,
                calendarEventId,
                occurrenceStartAt,
                exceptionType,
                title,
                description,
                startAt,
                endAt,
                Boolean.TRUE.equals(allDay),
                location,
                color
        );
    }

    public void update(CalendarEventException exception) {
        this.exceptionType = exception.type();
        this.title = exception.title();
        this.description = exception.description();
        this.startAt = exception.startAt();
        this.endAt = exception.endAt();
        this.allDay = exception.type() == CalendarEventExceptionType.OVERRIDDEN
                ? exception.allDay()
                : null;
        this.location = exception.location();
        this.color = exception.color();
        this.updatedAt = LocalDateTime.now();
    }
}
