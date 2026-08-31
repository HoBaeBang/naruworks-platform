package com.naruworks.api.dto.request;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

public record MemberRegistrationRequest(
        @NotNull
        @AssertTrue(message = "이용약관 동의가 필요합니다.")
        Boolean termsOfServiceAgreed,

        @NotNull
        @AssertTrue(message = "개인정보 처리방침 동의가 필요합니다.")
        Boolean privacyPolicyAgreed
) {
}
