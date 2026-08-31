package com.naruworks.domain.type;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum TermsAgreementType {
    TERMS_OF_SERVICE("v1"),
    PRIVACY_POLICY("v1");

    private final String version;
}
