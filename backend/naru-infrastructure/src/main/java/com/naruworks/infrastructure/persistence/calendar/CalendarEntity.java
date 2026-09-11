package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.Calendar;
import com.naruworks.domain.type.CalendarType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "calendars")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarEntity {

    /** 캘린더 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 캘린더를 생성하고 관리하는 회원 식별자 */
    @Column(name = "owner_member_id", nullable = false)
    private Long ownerMemberId;

    /** 화면에 표시할 캘린더 이름 */
    @Column(nullable = false, length = 100)
    private String name;

    /** 개인 캘린더 또는 공유 캘린더 구분 */
    @Enumerated(EnumType.STRING)
    @Column(name = "calendar_type", nullable = false, length = 30)
    private CalendarType type;

    /** 캘린더 생성 시각 */
    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** 캘린더 마지막 수정 시각 */
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    public static CalendarEntity from(Calendar calendar) {
        CalendarEntity entity = new CalendarEntity();
        entity.id = calendar.getId();
        entity.ownerMemberId = calendar.getOwnerMemberId();
        entity.name = calendar.getName();
        entity.type = calendar.getType();
        entity.createdAt = calendar.getCreatedAt() == null ? LocalDateTime.now() : calendar.getCreatedAt();
        entity.updatedAt = calendar.getUpdatedAt() == null ? LocalDateTime.now() : calendar.getUpdatedAt();
        return entity;
    }

    public Calendar toDomain() {
        return Calendar.builder()
                .id(id)
                .ownerMemberId(ownerMemberId)
                .name(name)
                .type(type)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }
}
