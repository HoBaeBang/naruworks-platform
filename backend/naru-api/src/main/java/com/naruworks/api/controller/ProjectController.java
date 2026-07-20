package com.naruworks.api.controller;

import com.naruworks.api.dto.response.ProjectResponse;
import com.naruworks.core.service.CatalogService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ProjectController {

    private final CatalogService catalogService;

    @GetMapping("/api/projects")
    public List<ProjectResponse> getProjects() {
        return catalogService.findPublicProjects()
                .stream()
                .map(ProjectResponse::from)
                .toList();
    }
}
