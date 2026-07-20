package com.naruworks.api.dto.response;

import com.naruworks.domain.model.Project;

public record ProjectResponse(
        String slug,
        String name,
        String description,
        String status
) {

    public static ProjectResponse from(Project project) {
        return new ProjectResponse(
                project.slug(),
                project.name(),
                project.description(),
                project.status().name()
        );
    }
}
