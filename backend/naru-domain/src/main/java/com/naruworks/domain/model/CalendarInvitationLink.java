package com.naruworks.domain.model;

import com.naruworks.domain.type.CalendarMemberRole;
import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Getter;

/** 공유 캘린더 참여 권한을 전달하는 단기 초대 링크 */
@Getter
@Builder
public class CalendarInvitationLink {

    private final Long id;
    private final Long calendarId;
    private final Long createdByMemberId;
    private final String tokenHash;
    private final CalendarMemberRole role;
    private final LocalDateTime expiresAt;
    private final LocalDateTime revokedAt;
    private final LocalDateTime createdAt;

    public boolean isUsableAt(LocalDateTime now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }
}
