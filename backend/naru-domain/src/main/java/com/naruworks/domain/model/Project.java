package com.naruworks.domain.model;

import com.naruworks.domain.type.ProjectStatus;

public record Project(
        String slug,
        String name,
        String description,
        ProjectStatus status
) {

    public static Project of(
            String slug,
            String name,
            String description,
            ProjectStatus status
    ) {
        return new Project(slug, name, description, status);
    }
}
