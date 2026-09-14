package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarType;
import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

/** 회원의 개인 일정 또는 여러 회원이 함께 쓰는 공유 일정 공간 */
@Getter
@Builder
public class Calendar {

    private final Long id;
    private final Long ownerMemberId;
    private final String name;
    private final CalendarType type;
    private final String displayColor;
    private final boolean defaultCalendar;
    private final LocalDateTime createdAt;
    private final LocalDateTime updatedAt;

    public static Calendar personal(Long memberId) {
        return Calendar.builder()
                .ownerMemberId(memberId)
                .name("내 캘린더")
                .type(CalendarType.PERSONAL)
                .displayColor("#20b977")
                .defaultCalendar(true)
                .build();
    }

    public static Calendar create(Long ownerMemberId, String name, CalendarType type, String displayColor) {
        return Calendar.builder()
                .ownerMemberId(ownerMemberId)
                .name(name)
                .type(type)
                .displayColor(displayColor)
                .defaultCalendar(false)
                .build();
    }

    /** 기존 캘린더의 표시 정보 또는 기본 개인 캘린더 여부를 바꾼 복사본을 만든다. */
    public Calendar withSettings(String name, String displayColor, boolean defaultCalendar) {
        return Calendar.builder()
                .id(id)
                .ownerMemberId(ownerMemberId)
                .name(name)
                .type(type)
                .displayColor(displayColor)
                .defaultCalendar(defaultCalendar)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }

    /** 공유 캘린더의 운영 책임자를 새 OWNER로 변경한 복사본을 만든다. */
    public Calendar withOwnerMemberId(Long ownerMemberId) {
        return Calendar.builder()
                .id(id)
                .ownerMemberId(ownerMemberId)
                .name(name)
                .type(type)
                .displayColor(displayColor)
                .defaultCalendar(defaultCalendar)
                .createdAt(createdAt)
                .updatedAt(updatedAt)
                .build();
    }
}
