package com.naruworks.core.port;

/** 외부 OAuth refresh token처럼 DB 평문 저장이 금지된 값을 암호화한다. */
public interface SensitiveDataEncryptor {

    String encrypt(String plainText);

    String decrypt(String encryptedText);
}
