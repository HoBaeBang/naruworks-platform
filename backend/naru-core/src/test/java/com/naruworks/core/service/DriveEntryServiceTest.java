package com.naruworks.core.service;

import com.naruworks.core.exception.DriveEntryAlreadyExistsException;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.port.DriveEntryReader;
import com.naruworks.core.port.DriveEntryWriter;
import com.naruworks.core.port.DriveFileReader;
import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.model.DriveFile;
import com.naruworks.domain.type.DriveEntryType;
import com.naruworks.domain.type.UploadStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;

@ExtendWith(MockitoExtension.class)
class DriveEntryServiceTest {

    @Mock private DriveEntryReader driveEntryReader;
    @Mock private DriveEntryWriter driveEntryWriter;
    @Mock private DriveFileReader driveFileReader;

    @Test
    @DisplayName("루트 목록은 폴더와 파일 메타데이터를 함께 반환한다")
    void findEntries_returnsRootEntriesAndFileMetadata() {
        DriveEntry folder = entry(10L, null, DriveEntryType.FOLDER, "여행");
        DriveEntry file = entry(11L, null, DriveEntryType.FILE, "계획.pdf");
        DriveFile driveFile = DriveFile.builder()
                .driveEntryId(11L)
                .storageKey("members/1/files/11/random")
                .sizeBytes(1_024L)
                .contentType("application/pdf")
                .uploadStatus(UploadStatus.AVAILABLE)
                .uploadStartedAt(LocalDateTime.of(2026, 10, 28, 10, 0))
                .build();
        given(driveEntryReader.findActiveChildren(1L, null)).willReturn(List.of(folder, file));
        given(driveFileReader.findByDriveEntryIds(List.of(11L))).willReturn(Map.of(11L, driveFile));

        var result = service().findEntries(1L, null);

        assertThat(result.parent()).isNull();
        assertThat(result.entries()).containsExactly(folder, file);
        assertThat(result.findFileByEntryId(11L)).contains(driveFile);
    }

    @Test
    @DisplayName("소유한 폴더 아래에 공백을 제거한 이름으로 새 폴더를 만든다")
    void createFolder_createsChildFolder() {
        DriveEntry parent = entry(10L, null, DriveEntryType.FOLDER, "여행");
        DriveEntry saved = entry(11L, 10L, DriveEntryType.FOLDER, "2026년 가을");
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L)).willReturn(Optional.of(parent));
        given(driveEntryWriter.save(any(DriveEntry.class))).willReturn(saved);

        DriveEntry result = service().createFolder(1L, 10L, " 2026년 가을 ");

        assertThat(result).isEqualTo(saved);
        ArgumentCaptor<DriveEntry> captured = ArgumentCaptor.forClass(DriveEntry.class);
        then(driveEntryWriter).should().save(captured.capture());
        assertThat(captured.getValue().getOwnerMemberId()).isEqualTo(1L);
        assertThat(captured.getValue().getParentId()).isEqualTo(10L);
        assertThat(captured.getValue().getEntryType()).isEqualTo(DriveEntryType.FOLDER);
        assertThat(captured.getValue().getName()).isEqualTo("2026년 가을");
    }

    @Test
    @DisplayName("타인의 폴더 또는 없는 폴더 아래에는 생성할 수 없다")
    void createFolder_rejectsMissingOrOtherMembersParent() {
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L)).willReturn(Optional.empty());

        assertThatThrownBy(() -> service().createFolder(1L, 10L, "여행"))
                .isInstanceOf(NotFoundException.class)
                .hasMessage("폴더를 찾을 수 없습니다.");
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("파일 아래에는 폴더를 만들 수 없다")
    void createFolder_rejectsFileParent() {
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L))
                .willReturn(Optional.of(entry(10L, null, DriveEntryType.FILE, "계획.pdf")));

        assertThatThrownBy(() -> service().createFolder(1L, 10L, "여행"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("상위 항목은 폴더여야 합니다.");
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("같은 폴더에 활성 항목과 이름이 같으면 충돌로 처리한다")
    void createFolder_rejectsDuplicateName() {
        given(driveEntryReader.existsActiveByOwnerMemberIdAndParentIdAndName(1L, null, "여행"))
                .willReturn(true);

        assertThatThrownBy(() -> service().createFolder(1L, null, "여행"))
                .isInstanceOf(DriveEntryAlreadyExistsException.class)
                .hasMessage("같은 폴더에 동일한 이름의 항목이 이미 존재합니다.");
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    @Test
    @DisplayName("경로 구분자와 제어 문자가 포함된 이름은 만들 수 없다")
    void createFolder_rejectsInvalidName() {
        assertThatThrownBy(() -> service().createFolder(1L, null, "여행/2026"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("폴더 이름에 경로 구분자를 사용할 수 없습니다.");
        then(driveEntryReader).shouldHaveNoInteractions();
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    @Test
    void renameEntry_updatesOwnedEntry() {
        DriveEntry original = entry(10L, null, DriveEntryType.FILE, "old.pdf");
        DriveEntry renamed = entry(10L, null, DriveEntryType.FILE, "new.pdf");
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L))
                .willReturn(Optional.of(original), Optional.of(renamed));
        given(driveEntryWriter.renameActive(10L, 1L, "new.pdf")).willReturn(true);
        assertThat(service().renameEntry(1L, 10L, " new.pdf ").getName()).isEqualTo("new.pdf");
    }

    @Test
    void renameEntry_sameNameDoesNotWrite() {
        DriveEntry original = entry(10L, null, DriveEntryType.FOLDER, "여행");
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L)).willReturn(Optional.of(original));
        assertThat(service().renameEntry(1L, 10L, "여행")).isSameAs(original);
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    @Test
    void renameEntry_rejectsMissingOrOtherOwnersEntry() {
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L)).willReturn(Optional.empty());
        assertThatThrownBy(() -> service().renameEntry(1L, 10L, "new"))
                .isInstanceOf(NotFoundException.class);
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    @Test
    void renameEntry_rejectsDuplicate() {
        given(driveEntryReader.findActiveByIdAndOwnerMemberId(10L, 1L))
                .willReturn(Optional.of(entry(10L, null, DriveEntryType.FOLDER, "old")));
        given(driveEntryReader.existsActiveByOwnerMemberIdAndParentIdAndName(1L, null, "new"))
                .willReturn(true);
        assertThatThrownBy(() -> service().renameEntry(1L, 10L, "new"))
                .isInstanceOf(DriveEntryAlreadyExistsException.class);
        then(driveEntryWriter).shouldHaveNoInteractions();
    }

    private DriveEntryService service() {
        return new DriveEntryService(driveEntryReader, driveEntryWriter, driveFileReader);
    }

    private DriveEntry entry(Long id, Long parentId, DriveEntryType type, String name) {
        return DriveEntry.builder()
                .id(id)
                .ownerMemberId(1L)
                .parentId(parentId)
                .entryType(type)
                .name(name)
                .updatedAt(LocalDateTime.of(2026, 10, 28, 10, 0))
                .build();
    }
}
