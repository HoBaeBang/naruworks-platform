package com.naruworks.domain.type;

public enum MemberStatus {
    /** 가입 심사 대기 상태. 향후 수동 승인 가입 경로를 위한 예약 값 */
    PENDING,

    /** 승인되어 NaruWorks 서비스를 이용할 수 있는 상태 */
    APPROVED,

    /** 가입 또는 서비스 이용이 거절된 상태 */
    REJECTED,

    /** 운영자가 서비스 이용을 일시 정지한 상태 */
    SUSPENDED
}
