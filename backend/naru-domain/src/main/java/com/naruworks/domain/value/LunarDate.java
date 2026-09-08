package com.naruworks.domain.value;

/**
 * 한국 음력의 월·일과 윤달 여부를 표현하는 불변 값 객체다.
 */
public record LunarDate(
        int month,
        int day,
        boolean intercalation
) {

    public LunarDate {
        if (month < 1 || month > 12) {
            throw new IllegalArgumentException("음력 월은 1부터 12 사이여야 합니다.");
        }

        if (day < 1 || day > 30) {
            throw new IllegalArgumentException("음력 일은 1부터 30 사이여야 합니다.");
        }
    }

    public static LunarDate of(int month, int day, boolean intercalation) {
        return new LunarDate(month, day, intercalation);
    }

    /** 윤달에서 시작한 반복 일정도 이후에는 같은 평달 기준으로 계산한다. */
    public LunarDate asRegularMonth() {
        return new LunarDate(month, day, false);
    }
}
