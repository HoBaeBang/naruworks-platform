package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarHolidayOverride;
import com.naruworks.domain.type.CalendarHolidayOverrideOperation;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Getter
@Entity
@Table(name = "calendar_holiday_overrides")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarHolidayOverrideEntity {

    /** 공휴일 예외의 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 예외를 적용할 양력 날짜 */
    @Column(name = "holiday_date", nullable = false)
    private LocalDate holidayDate;

    /** 공휴일 추가 또는 제외 작업 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private CalendarHolidayOverrideOperation operation;

    /** ADD 작업일 때 표시할 공휴일명 */
    @Column(name = "holiday_name", length = 100)
    private String holidayName;

    /** 운영자가 남긴 등록 근거 또는 메모 */
    @Column(length = 255)
    private String reason;

    /** 예외 row가 최초 생성된 시각 */
    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** 예외 row가 마지막 수정된 시각 */
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    public CalendarHolidayOverride toDomain() {
        return CalendarHolidayOverride.of(id, holidayDate, operation, holidayName, reason);
    }
}
