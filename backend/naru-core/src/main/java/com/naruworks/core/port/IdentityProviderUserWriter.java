package com.naruworks.core.port;

public interface IdentityProviderUserWriter {

    /** IdP(Keycloak)에서 사용자를 삭제한다. 이미 없으면 아무 일도 하지 않는다. */
    void deleteUser(String userId);
}
