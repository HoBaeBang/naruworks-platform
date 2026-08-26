package com.naruworks.domain.value;

import java.util.Locale;
import java.util.regex.Pattern;

public record ReferralCode(String value) {

    private static final Pattern FORMAT = Pattern.compile("^[A-Z0-9]{6}$");

    public ReferralCode {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("추천 코드는 필수입니다.");
        }

        value = value.trim().toUpperCase(Locale.ROOT);

        if (!FORMAT.matcher(value).matches()) {
            throw new IllegalArgumentException(
                    "추천 코드는 영문 대문자와 숫자로 구성된 6자리여야 합니다."
            );
        }
    }

    public static ReferralCode of(String value) {
        return new ReferralCode(value);
    }
}
