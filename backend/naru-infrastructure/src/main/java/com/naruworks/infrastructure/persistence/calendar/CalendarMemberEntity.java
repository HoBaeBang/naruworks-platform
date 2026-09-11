package com.naruworks.infrastructure.persistence.calendar;

import com.naruworks.domain.model.CalendarMember;
import com.naruworks.domain.type.CalendarMemberRole;
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
@Table(name = "calendar_members")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CalendarMemberEntity {

    /** 캘린더 참여 관계 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 참여 대상 캘린더 식별자 */
    @Column(name = "calendar_id", nullable = false)
    private Long calendarId;

    /** 캘린더에 참여한 회원 식별자 */
    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** 캘린더 안에서 허용된 권한 */
    @Enumerated(EnumType.STRING)
    @Column(name = "member_role", nullable = false, length = 30)
    private CalendarMemberRole role;

    /** 캘린더 참여 시각 */
    @Column(nullable = false)
    private LocalDateTime createdAt;

    public static CalendarMemberEntity from(CalendarMember calendarMember) {
        CalendarMemberEntity entity = new CalendarMemberEntity();
        entity.id = calendarMember.id();
        entity.calendarId = calendarMember.calendarId();
        entity.memberId = calendarMember.memberId();
        entity.role = calendarMember.role();
        entity.createdAt = calendarMember.createdAt() == null
                ? LocalDateTime.now()
                : calendarMember.createdAt();
        return entity;
    }

    public CalendarMember toDomain() {
        return new CalendarMember(id, calendarId, memberId, role, createdAt);
    }
}
