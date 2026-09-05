package com.naruworks.core.model;

import com.naruworks.domain.model.Member;

public record MemberAdministrationMember(
        Member member,
        Member referrer
) {
}
