package com.naruworks.domain.type;

/** 반복 일정 변경을 적용할 범위 */
public enum CalendarEventOccurrenceScope {
    /** 선택한 발생 일정 한 건에만 적용 */
    THIS,

    /** 선택한 발생 일정부터 이후 시리즈에 적용 */
    THIS_AND_FOLLOWING,

    /** 반복 시리즈 전체에 적용 */
    ALL
}
