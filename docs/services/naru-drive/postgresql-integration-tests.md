# Drive PostgreSQL 통합 테스트

Drive의 부분 유일 인덱스와 동시 이동은 H2로 검증하지 못한다. CI는 별도의 PostgreSQL 16 서비스에 Flyway migration을 적용해 통합 테스트를 실행한다. 기존 개발 DB나 운영 DB를 테스트 대상으로 사용하지 않는다.

격리된 테스트 DB를 준비한 뒤 다음 환경 변수를 지정해 실행한다.

```bash
cd backend
NARU_DRIVE_POSTGRES_TEST=true \
NARU_TEST_DATABASE_URL=jdbc:postgresql://localhost:5432/naru_drive_test \
NARU_TEST_DATABASE_USER=naru_test \
NARU_TEST_DATABASE_PASSWORD=naru_test \
./gradlew :naru-api:test --tests com.naruworks.api.drive.DrivePostgresIntegrationTest
```

테스트는 새 회원과 항목을 생성하며 DB에 남긴다. 반드시 폐기 가능한 전용 테스트 DB를 사용한다. 환경 변수를 지정하지 않은 일반 테스트에서는 PostgreSQL 테스트가 실행되지 않는다.
