package com.naruworks.core.service;

import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.model.MemberAdministrationMember;
import com.naruworks.core.port.MemberReader;
import com.naruworks.core.port.MemberWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MemberAdministrationService {

    private final MemberReader memberReader;
    private final MemberWriter memberWriter;

    @Transactional(readOnly = true)
    public List<MemberAdministrationMember> getMembers() {
        List<Member> members = memberReader.findAllByOrderByCreatedAtDesc();
        Set<Long> referrerMemberIds = members.stream()
                .map(Member::getReferrerMemberId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, Member> referrersById = memberReader.findAllByIdIn(referrerMemberIds).stream()
                .collect(Collectors.toMap(Member::getId, Function.identity()));

        return members.stream()
                .map(member -> new MemberAdministrationMember(
                        member,
                        referrersById.get(member.getReferrerMemberId())
                ))
                .toList();
    }

    @Transactional
    public MemberAdministrationMember changeMemberStatus(
            Long memberId,
            MemberStatus status
    ) {
        Member targetMember = memberReader.findById(memberId)
                .orElseThrow(() -> new NotFoundException("회원을 찾을 수 없습니다."));

        Member changedMember = memberWriter.save(
                targetMember.changeOperationalStatus(status)
        );

        Member referrer = changedMember.getReferrerMemberId() == null
                ? null
                : memberReader.findById(changedMember.getReferrerMemberId()).orElse(null);

        return new MemberAdministrationMember(changedMember, referrer);
    }

}
