package com.naruworks.api.drive;

import com.naruworks.core.exception.DriveEntryAlreadyExistsException;
import com.naruworks.core.service.DriveEntryService;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.value.ReferralCode;
import com.naruworks.infrastructure.persistence.member.MemberEntity;
import com.naruworks.infrastructure.persistence.member.MemberJpaRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@EnabledIfEnvironmentVariable(named = "NARU_DRIVE_POSTGRES_TEST", matches = "true")
@SpringBootTest(properties = {
        "spring.datasource.url=${NARU_TEST_DATABASE_URL}",
        "spring.datasource.username=${NARU_TEST_DATABASE_USER}",
        "spring.datasource.password=${NARU_TEST_DATABASE_PASSWORD}",
        "spring.flyway.enabled=true",
        "spring.jpa.hibernate.ddl-auto=validate",
        "naru.google-calendar.sync.enabled=false"
})
class DrivePostgresIntegrationTest {
    @Autowired private DriveEntryService driveEntryService;
    @Autowired private MemberJpaRepository memberRepository;
    @Autowired private JdbcTemplate jdbc;
    private Long ownerId;

    @BeforeEach
    void createMember() {
        String suffix = UUID.randomUUID().toString();
        Member member = Member.createApprovedInitialAdminGoogleMember(
                suffix + "@example.com", "Drive test", null, suffix,
                ReferralCode.of(suffix.substring(0, 6).toUpperCase()), LocalDateTime.now());
        ownerId = memberRepository.saveAndFlush(MemberEntity.from(member)).getId();
    }

    @Test
    @DisplayName("부분 유일 인덱스는 같은 위치의 활성 이름을 제한하고 삭제된 이름은 허용한다")
    void activeNamesAreUniqueInRootAndFolder() {
        Long rootId = driveEntryService.createFolder(ownerId, null, "root").getId();
        assertThatThrownBy(() -> jdbc.update(
                "insert into drive_entries (owner_member_id, entry_type, name) values (?, 'FOLDER', 'root')", ownerId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> driveEntryService.createFolder(ownerId, null, "root"))
                .isInstanceOf(DriveEntryAlreadyExistsException.class);
        driveEntryService.createFolder(ownerId, rootId, "child");
        assertThatThrownBy(() -> jdbc.update(
                "insert into drive_entries (owner_member_id, parent_id, entry_type, name) values (?, ?, 'FILE', 'child')",
                ownerId, rootId)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> driveEntryService.createFolder(ownerId, rootId, "child"))
                .isInstanceOf(DriveEntryAlreadyExistsException.class);
        jdbc.update("update drive_entries set deleted_at = current_timestamp where id = ?", rootId);
        assertThat(driveEntryService.createFolder(ownerId, null, "root").getId()).isNotEqualTo(rootId);
    }

    @Test
    @DisplayName("동시에 서로를 하위로 이동해도 순환 구조가 만들어지지 않는다")
    void concurrentMovesDoNotCreateCycle() throws Exception {
        Long first = driveEntryService.createFolder(ownerId, null, "first").getId();
        Long second = driveEntryService.createFolder(ownerId, null, "second").getId();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> results = List.of(
                    executor.submit(() -> moveAfterStart(first, second, ready, start)),
                    executor.submit(() -> moveAfterStart(second, first, ready, start)));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(results.get(0).get(20, TimeUnit.SECONDS), results.get(1).get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
            Long firstParent = jdbc.queryForObject("select parent_id from drive_entries where id = ?", Long.class, first);
            Long secondParent = jdbc.queryForObject("select parent_id from drive_entries where id = ?", Long.class, second);
            assertThat(firstParent == null || secondParent == null).isTrue();
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    private boolean moveAfterStart(Long id, Long parentId, CountDownLatch ready, CountDownLatch start)
            throws InterruptedException {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("동시 실행 시작 시간 초과");
        try {
            driveEntryService.moveEntry(ownerId, id, parentId);
            return true;
        } catch (IllegalArgumentException expected) {
            return false;
        }
    }
}
