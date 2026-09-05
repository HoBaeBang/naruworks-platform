package com.naruworks.domain.type;

public enum ServiceStatus {
    /** 기획 또는 개발 준비 단계인 서비스 */
    PLANNING,

    /** 다음 개발 대상으로 예정된 서비스 */
    NEXT,

    /** 화면과 기본 구조만 마련된 초기 서비스 */
    SKELETON
}
