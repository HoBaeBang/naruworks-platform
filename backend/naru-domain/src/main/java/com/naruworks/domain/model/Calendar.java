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
    private final LocalDateTime createdAt;
    private final LocalDateTime updatedAt;

    public static Calendar personal(Long memberId) {
        return Calendar.builder()
                .ownerMemberId(memberId)
                .name("내 캘린더")
                .type(CalendarType.PERSONAL)
                .build();
    }

    public static Calendar shared(Long ownerMemberId, String name) {
        return Calendar.builder()
                .ownerMemberId(ownerMemberId)
                .name(name)
                .type(CalendarType.SHARED)
                .build();
    }
}
