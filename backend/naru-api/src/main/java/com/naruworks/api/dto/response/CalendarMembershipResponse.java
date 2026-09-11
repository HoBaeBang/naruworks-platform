package com.naruworks.api.dto.response;

import com.naruworks.domain.model.CalendarMembership;
import com.naruworks.domain.type.CalendarMemberRole;
import com.naruworks.domain.type.CalendarType;

public record CalendarMembershipResponse(
        Long id,
        String name,
        CalendarType type,
        Long ownerMemberId,
        CalendarMemberRole role
) {
    public static CalendarMembershipResponse from(CalendarMembership membership) {
        return new CalendarMembershipResponse(
                membership.calendar().getId(),
                membership.calendar().getName(),
                membership.calendar().getType(),
                membership.calendar().getOwnerMemberId(),
                membership.role()
        );
    }
}
