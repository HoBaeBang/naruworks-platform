package com.naruworks.infrastructure.persistence.drive;

import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.type.DriveEntryType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(
        properties = {
                "spring.flyway.enabled=false",
                "spring.jpa.hibernate.ddl-auto=create-drop"
        }
)
class DriveEntriesJpaRepositoryTest {
    private static final Long OWNER_A = 1L;

    @Autowired
    private DriveEntriesJpaRepository driveEntriesJpaRepository;

    @Test
    @DisplayName("활성 자식 항목은 폴더를 먼저 이름순으로 조회한다.")
    void findActiveChildren() {
        saveEntry(OWNER_A, "B-folder", DriveEntryType.FOLDER, null, null);
        saveEntry(OWNER_A, "A-file", DriveEntryType.FILE, null, null);
        saveEntry(OWNER_A, "A-folder", DriveEntryType.FOLDER, null, null);
        saveEntry(OWNER_A, "deleted-folder", DriveEntryType.FOLDER, null, LocalDateTime.now());

        List<DriveEntriesEntity> entries = driveEntriesJpaRepository.findActiveChildren(OWNER_A, null);

        List<String> names = entries.stream()
                .map(DriveEntriesEntity::toDomain)
                .map(DriveEntry::getName)
                .toList();

        assertThat(names).containsExactly("A-folder", "B-folder", "A-file");
    }

    @Test
    @DisplayName("활성 목록은 소유자만 단건 조회할 수 있다.")
    void findActiveByIdAndOwnerMemberId() {
        Long activeEntryId = saveEntry(
                OWNER_A,
                "active-folder",
                DriveEntryType.FOLDER,
                null,
                null
        ).toDomain().getId();

        Long deletedEntryId = saveEntry(
                OWNER_A,
                "deleted-folder",
                DriveEntryType.FOLDER,
                null,
                LocalDateTime.of(2026, 10, 11, 10, 0)
        ).toDomain().getId();

        assertThat(
                driveEntriesJpaRepository.findByIdAndOwnerMemberIdAndDeletedAtIsNull(
                        activeEntryId,
                        OWNER_A
                )
        ).isPresent();

        assertThat(
                driveEntriesJpaRepository.findByIdAndOwnerMemberIdAndDeletedAtIsNull(
                        deletedEntryId,
                        OWNER_A
                )
        ).isEmpty();

        assertThat(
                driveEntriesJpaRepository.findByIdAndOwnerMemberIdAndDeletedAtIsNull(
                        activeEntryId,
                        2L
                )
        ).isEmpty();
    }

    @Test
    @DisplayName("특정 폴더를 조회하면 해당 폴더의 활성 자식만 반환한다")
    void findActiveChildrenByParentId() {
        Long travelFolderId = saveEntry(
                OWNER_A,
                "travel",
                DriveEntryType.FOLDER,
                null,
                null
        ).toDomain().getId();

        Long workFolderId = saveEntry(
                OWNER_A,
                "work",
                DriveEntryType.FOLDER,
                null,
                null
        ).toDomain().getId();

        saveEntry(
                OWNER_A,
                "photo.jpg",
                DriveEntryType.FILE,
                travelFolderId,
                null
        );
        saveEntry(
                OWNER_A,
                "document.pdf",
                DriveEntryType.FILE,
                workFolderId,
                null
        );
        saveEntry(
                OWNER_A,
                "root-note.txt",
                DriveEntryType.FILE,
                null,
                null
        );

        List<String> names = driveEntriesJpaRepository
                .findActiveChildren(OWNER_A, travelFolderId)
                .stream()
                .map(DriveEntriesEntity::toDomain)
                .map(DriveEntry::getName)
                .toList();

        assertThat(names).containsExactly("photo.jpg");
    }

    private DriveEntriesEntity saveEntry(
            Long ownerMemberId,
            String name,
            DriveEntryType type,
            Long parentId,
            LocalDateTime deletedAt
    ) {
        DriveEntry entry = DriveEntry.builder()
                .ownerMemberId(ownerMemberId)
                .parentId(parentId)
                .entryType(type)
                .name(name)
                .deletedAt(deletedAt)
                .build();

        return driveEntriesJpaRepository.saveAndFlush(
                DriveEntriesEntity.from(entry)
        );
    }
}
