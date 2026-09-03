package com.naruworks.api.controller;

import com.naruworks.api.dto.response.MemberProfileResponse;
import com.naruworks.api.security.CurrentMember;
import com.naruworks.domain.model.Member;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/members")
public class MemberController {

    @GetMapping("/me")
    public MemberProfileResponse getMyProfile(@CurrentMember Member member) {
        return MemberProfileResponse.from(member);
    }
}
