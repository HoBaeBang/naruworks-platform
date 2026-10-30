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

    @GetMapping("/entries")
    public DriveEntryListResponse getEntries(
            @CurrentMember Member member,
            @RequestParam(required = false) Long parentId
    ) {
        return DriveEntryListResponse.from(driveEntryService.findEntries(member.getId(), parentId));
    }

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

    @PatchMapping("/entries/{entryId}")
    public DriveEntryResponse renameEntry(
            @CurrentMember Member member,
            @PathVariable Long entryId,
            @Valid @RequestBody DriveEntryRenameRequest request
    ) {
        return DriveEntryResponse.from(driveEntryService.renameEntry(member.getId(), entryId, request.name()), null);
    }
}
