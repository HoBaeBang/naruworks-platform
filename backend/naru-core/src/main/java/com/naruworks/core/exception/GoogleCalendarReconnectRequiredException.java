package com.naruworks.core.exception;

/** Google이 저장된 refresh token을 거절해 사용자가 계정을 다시 연결해야 하는 경우. */
public class GoogleCalendarReconnectRequiredException extends RuntimeException {

    public GoogleCalendarReconnectRequiredException() {
        super("Google 계정 연결이 만료되었습니다. 다시 연결해주세요.");
    }
}
