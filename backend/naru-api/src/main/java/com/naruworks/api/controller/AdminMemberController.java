package com.naruworks.api.controller;

import com.naruworks.api.dto.request.MemberStatusUpdateRequest;
import com.naruworks.api.dto.response.AdminMemberResponse;
import com.naruworks.core.service.MemberAdministrationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/admin/members")
public class AdminMemberController {

    private final MemberAdministrationService memberAdministrationService;

    @GetMapping
    public List<AdminMemberResponse> getMembers() {
        return memberAdministrationService.getMembers().stream()
                .map(AdminMemberResponse::from)
                .toList();
    }

    @PatchMapping("/{memberId}/status")
    public AdminMemberResponse changeMemberStatus(
            @PathVariable Long memberId,
            @Valid @RequestBody MemberStatusUpdateRequest request
    ) {
        return AdminMemberResponse.from(
                memberAdministrationService.changeMemberStatus(memberId, request.status())
        );
    }
}
