package com.naruworks.domain.type;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum TermsAgreementType {
    /** 서비스 이용을 위한 이용약관 동의 */
    TERMS_OF_SERVICE("v1"),

    /** 개인정보 수집 및 이용을 위한 개인정보 처리방침 동의 */
    PRIVACY_POLICY("v1");

    /** 동의한 약관 문서 버전 */
    private final String version;
}
