package com.naruworks.infrastructure.calendar;

import com.naruworks.core.port.SensitiveDataEncryptor;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** AES-256-GCM으로 OAuth refresh token을 DB 저장 전에 암호화한다. */
@Component
@RequiredArgsConstructor
public class AesGcmSensitiveDataEncryptor implements SensitiveDataEncryptor {

    private static final int IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final GoogleCalendarOAuthProperties properties;

    @Override
    public String encrypt(String plainText) {
        try {
            byte[] iv = new byte[IV_LENGTH];
            SECURE_RANDOM.nextBytes(iv);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(decodeKey(), "AES"),
                    new GCMParameterSpec(GCM_TAG_LENGTH, iv)
            );

            byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception exception) {
            throw new IllegalStateException("Google Calendar refresh token 암호화에 실패했습니다.", exception);
        }
    }

    @Override
    public String decrypt(String encryptedText) {
        try {
            byte[] combined = Base64.getDecoder().decode(encryptedText);
            if (combined.length <= IV_LENGTH) {
                throw new IllegalArgumentException("암호문 형식이 올바르지 않습니다.");
            }

            byte[] iv = new byte[IV_LENGTH];
            byte[] encrypted = new byte[combined.length - IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, IV_LENGTH);
            System.arraycopy(combined, IV_LENGTH, encrypted, 0, encrypted.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(decodeKey(), "AES"),
                    new GCMParameterSpec(GCM_TAG_LENGTH, iv)
            );
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception exception) {
            throw new IllegalStateException("Google Calendar refresh token 복호화에 실패했습니다.", exception);
        }
    }

    private byte[] decodeKey() {
        try {
            byte[] key = Base64.getDecoder().decode(properties.getTokenEncryptionKey());
            if (key.length != 32) {
                throw new IllegalArgumentException("AES-256 키는 32바이트여야 합니다.");
            }
            return key;
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY는 Base64 인코딩된 32바이트 키여야 합니다.",
                    exception
            );
        }
    }
}
