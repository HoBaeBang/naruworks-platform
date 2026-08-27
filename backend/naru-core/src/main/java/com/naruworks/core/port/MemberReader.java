package com.naruworks.core.port;

import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.AuthProvider;
import com.naruworks.domain.value.ReferralCode;

import javax.swing.text.html.Option;
import java.util.Optional;

public interface MemberReader {

    Optional<Member> findByProviderAndProviderUserId(AuthProvider authProvider, String providerUserId);

    Optional<Member> findByReferralCode(ReferralCode referralCode);

    boolean existsAnyMember();
}
