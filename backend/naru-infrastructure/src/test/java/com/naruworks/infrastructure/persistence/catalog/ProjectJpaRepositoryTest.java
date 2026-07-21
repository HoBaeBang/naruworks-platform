package com.naruworks.infrastructure.persistence.catalog;

import com.naruworks.domain.type.ProjectStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class ProjectJpaRepositoryTest {

    @Autowired
    private ProjectJpaRepository projectJpaRepository;

    @Test
    @DisplayName("프로젝트를 display_order 오름차순으로 조회한다")
    void findAllByOrderByDisplayOrderAsc() {
        projectJpaRepository.save(ProjectEntity.of(
                "third-project",
                "Third Project",
                "세 번째 프로젝트",
                ProjectStatus.PHASE_1,
                3
        ));
        projectJpaRepository.save(ProjectEntity.of(
                "first-project",
                "First Project",
                "첫 번째 프로젝트",
                ProjectStatus.EXTERNAL_MODULE,
                1
        ));
        projectJpaRepository.save(ProjectEntity.of(
                "second-project",
                "Second Project",
                "두 번째 프로젝트",
                ProjectStatus.PHASE_1,
                2
        ));

        List<ProjectEntity> projects = projectJpaRepository.findAllByOrderByDisplayOrderAsc();

        assertThat(projects)
                .extracting(ProjectEntity::getSlug)
                .containsExactly("first-project", "second-project", "third-project");

        assertThat(projects.get(0).getStatus()).isEqualTo(ProjectStatus.EXTERNAL_MODULE);
        assertThat(projects.get(0).getName()).isEqualTo("First Project");
        assertThat(projects.get(0).getDescription()).isEqualTo("첫 번째 프로젝트");
    }
}
