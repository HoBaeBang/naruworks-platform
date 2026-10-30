package com.naruworks.core.port;

public interface IdentityProviderUserWriter {

    /** IdP(Keycloak)에서 사용자를 삭제한다. 이미 없으면 아무 일도 하지 않는다. */
    void deleteUser(String userId);

    /** IdP 사용자에게 승인 회원 역할을 부여하거나(member=true) 제거한다(false). 이미 그 상태면 아무 일도 하지 않는다. */
    void setMemberRole(String userId, boolean member);
}
