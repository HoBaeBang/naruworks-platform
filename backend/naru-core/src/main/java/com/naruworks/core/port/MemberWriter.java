package com.naruworks.core.port;

import com.naruworks.domain.model.Member;

public interface MemberWriter {
    Member save(Member member);
}
