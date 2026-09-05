package com.naruworks.core.service;

import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class MemberAdministrationService {

    private final MemberReader memberReader;
    private final MemberWriter memberWriter;

    @Transactional(readOnly = true)
    public List<Member> getMembers() {
        return memberReader.findAllByOrderByCreatedAtDesc();
    }

    @Transactional
    public Member changeMemberStatus(
            Long memberId,
            MemberStatus status
    ) {
        Member targetMember = memberReader.findById(memberId)
                .orElseThrow(() -> new NotFoundException("회원을 찾을 수 없습니다."));

        return memberWriter.save(
                targetMember.changeOperationalStatus(status)
        );
    }

}
