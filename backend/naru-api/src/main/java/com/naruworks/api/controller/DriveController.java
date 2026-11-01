package com.naruworks.api.controller;

import com.naruworks.api.dto.request.DriveFolderCreateRequest;
import com.naruworks.api.dto.request.DriveEntryRenameRequest;
import com.naruworks.api.dto.response.DriveEntryListResponse;
import com.naruworks.api.dto.response.DriveEntryResponse;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.core.service.DriveEntryService;
import com.naruworks.domain.model.Member;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/drive")
public class DriveController {

    private final DriveEntryService driveEntryService;

    /**
     * 로그인 회원의 루트 또는 지정한 폴더의 바로 아래 항목을 조회한다.
     * @param member 현재 로그인한 회원
     * @param parentId 상위 폴더 ID. 생략하면 개인 루트를 조회한다.
     */
    @GetMapping("/entries")
    public DriveEntryListResponse getEntries(
            @CurrentMember Member member,
            @RequestParam(required = false) Long parentId
    ) {
        return DriveEntryListResponse.from(driveEntryService.findEntries(member.getId(), parentId));
    }

    /**
     * 로그인 회원의 루트 또는 지정한 폴더 아래에 폴더를 생성한다.
     * @param member 현재 로그인한 회원
     * @param request 생성할 폴더 이름과 선택적인 상위 폴더 ID
     */
    @PostMapping("/folders")
    @ResponseStatus(HttpStatus.CREATED)
    public DriveEntryResponse createFolder(
            @CurrentMember Member member,
            @Valid @RequestBody DriveFolderCreateRequest request
    ) {
        return DriveEntryResponse.from(
                driveEntryService.createFolder(member.getId(), request.parentId(), request.name()),
                null
        );
    }

    /**
     * 로그인 회원이 소유한 파일 또는 폴더의 이름을 변경한다.
     * @param member 현재 로그인한 회원
     * @param entryId 이름을 변경할 파일 또는 폴더 ID
     * @param request 변경할 이름
     */
    @PatchMapping("/entries/{entryId}")
    public DriveEntryResponse renameEntry(
            @CurrentMember Member member,
            @PathVariable Long entryId,
            @Valid @RequestBody DriveEntryRenameRequest request
    ) {
        return DriveEntryResponse.from(driveEntryService.renameEntry(member.getId(), entryId, request.name()), null);
    }
}
