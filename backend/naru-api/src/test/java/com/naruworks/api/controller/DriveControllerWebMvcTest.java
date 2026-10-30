package com.naruworks.api.controller;

import com.naruworks.api.security.CurrentMemberArgumentResolver;
import com.naruworks.core.exception.DriveEntryAlreadyExistsException;
import com.naruworks.core.exception.NotFoundException;
import com.naruworks.core.model.DriveEntryList;
import com.naruworks.core.service.DriveEntryService;
import com.naruworks.domain.model.DriveEntry;
import com.naruworks.domain.model.Member;
import com.naruworks.domain.type.DriveEntryType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(DriveController.class)
class DriveControllerWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DriveEntryService driveEntryService;

    @MockitoBean
    private CurrentMemberArgumentResolver currentMemberArgumentResolver;

    @BeforeEach
    void setUp() throws Exception {
        given(currentMemberArgumentResolver.supportsParameter(any())).willReturn(true);
        given(currentMemberArgumentResolver.resolveArgument(any(), any(), any(), any()))
                .willReturn(Member.builder().id(1L).build());
    }

    @Test
    @DisplayName("루트 항목 목록을 반환한다")
    void getEntries_returnsRootEntries() throws Exception {
        DriveEntry folder = entry(10L, null, DriveEntryType.FOLDER, "여행");
        given(driveEntryService.findEntries(1L, null))
                .willReturn(new DriveEntryList(null, List.of(folder), Map.of()));

        mockMvc.perform(get("/api/drive/entries"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.parent").isEmpty())
                .andExpect(jsonPath("$.entries[0].id").value(10))
                .andExpect(jsonPath("$.entries[0].type").value("FOLDER"))
                .andExpect(jsonPath("$.entries[0].name").value("여행"));
    }

    @Test
    @DisplayName("폴더 생성 요청은 생성된 폴더를 반환한다")
    void createFolder_returnsCreatedFolder() throws Exception {
        DriveEntry created = entry(10L, null, DriveEntryType.FOLDER, "여행");
        given(driveEntryService.createFolder(1L, null, "여행")).willReturn(created);

        mockMvc.perform(post("/api/drive/folders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"여행\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(10))
                .andExpect(jsonPath("$.type").value("FOLDER"))
                .andExpect(jsonPath("$.name").value("여행"));
    }

    @Test
    @DisplayName("유효하지 않은 폴더 생성 요청은 400을 반환한다")
    void createFolder_returnsBadRequestForInvalidRequest() throws Exception {
        mockMvc.perform(post("/api/drive/folders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\" \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("존재하지 않거나 소유하지 않은 상위 폴더는 404를 반환한다")
    void createFolder_returnsNotFoundForUnavailableParent() throws Exception {
        given(driveEntryService.createFolder(1L, 10L, "여행"))
                .willThrow(new NotFoundException("폴더를 찾을 수 없습니다."));

        mockMvc.perform(post("/api/drive/folders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"parentId\":10,\"name\":\"여행\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("폴더를 찾을 수 없습니다."));
    }

    @Test
    @DisplayName("동일한 이름의 활성 항목이 있으면 409를 반환한다")
    void createFolder_returnsConflictForDuplicateName() throws Exception {
        given(driveEntryService.createFolder(1L, null, "여행"))
                .willThrow(new DriveEntryAlreadyExistsException("같은 폴더에 동일한 이름의 항목이 이미 존재합니다."));

        mockMvc.perform(post("/api/drive/folders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"여행\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("같은 폴더에 동일한 이름의 항목이 이미 존재합니다."));
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
