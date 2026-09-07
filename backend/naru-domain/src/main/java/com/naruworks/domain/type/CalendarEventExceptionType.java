package com.naruworks.domain.type;

/** 반복 일정 원본과 다른 특정 발생 일정의 처리 방식 */
public enum CalendarEventExceptionType {
    /** 특정 발생 일정을 화면에서 제외 */
    CANCELLED,

    /** 특정 발생 일정의 상세 값을 원본 대신 사용 */
    OVERRIDDEN
}
