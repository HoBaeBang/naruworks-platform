package com.naruworks.domain.type;

public enum CalendarEventRecurrenceRule {
    /** 반복하지 않는 단일 일정 */
    NONE,

    /** 매주 같은 요일에 반복하는 일정 */
    WEEKLY,

    /** 매월 같은 일자에 반복하는 일정 */
    MONTHLY,

    /** 매년 같은 월일에 반복하는 일정 */
    YEARLY
}
