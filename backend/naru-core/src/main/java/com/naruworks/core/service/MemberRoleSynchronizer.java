package com.naruworks.core.service;

import com.naruworks.core.port.IdentityProviderUserWriter;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.MemberStatus;
import java.util.logging.Level;
import java.util.logging.Logger;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 회원 상태(우리 DB가 기준)를 IdP의 승인 회원 역할에 반영한다. 다른 서비스는 이 역할로 접근을 제한한다.
 * 가입과 로그인에서는 IdP 호출이 실패해도 회원 처리를 막지 않고 로그만 남긴다(다음 로그인 때 다시 맞춘다).
 * 관리자의 상태 변경은 실패하면 예외를 던져 변경을 되돌린다. 정지했는데 역할이 남는 상태를 만들지 않기 위해서다.
 */
@Component
@RequiredArgsConstructor
public class MemberRoleSynchronizer {

    private static final Logger LOGGER = Logger.getLogger(MemberRoleSynchronizer.class.getName());

    private final IdentityProviderUserWriter identityProviderUserWriter;

    public void sync(Member member) {
        try {
            syncOrThrow(member);
        } catch (RuntimeException exception) {
            LOGGER.log(Level.WARNING, "IdP 회원 역할 동기화에 실패했다. sub=" + member.getProviderUserId(), exception);
        }
    }

    public void syncOrThrow(Member member) {
        identityProviderUserWriter.setMemberRole(
                member.getProviderUserId(),
                member.getStatus() == MemberStatus.APPROVED
        );
    }
}
