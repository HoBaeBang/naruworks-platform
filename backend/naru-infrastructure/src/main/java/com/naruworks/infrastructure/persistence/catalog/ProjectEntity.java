package com.naruworks.infrastructure.persistence.catalog;

import com.naruworks.domain.model.Project;
import com.naruworks.domain.type.ProjectStatus;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "projects")
public class ProjectEntity {

    /** 프로젝트 테이블의 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** URL과 API에서 사용하는 프로젝트 고유 식별자 */
    private String slug;

    /** 공개 화면에 표시할 프로젝트 이름 */
    private String name;

    /** 프로젝트의 목적과 내용을 설명하는 문구 */
    private String description;

    /** 프로젝트의 현재 진행 또는 연결 상태 */
    @Enumerated(EnumType.STRING)
    private ProjectStatus status;

    /** 공개 목록에서 프로젝트를 보여줄 정렬 순서 */
    @Column(name = "display_order")
    private int displayOrder;

    public Project toDomain() {
        return Project.of(slug, name, description, status);
    }

    public static ProjectEntity of(
            String slug,
            String name,
            String description,
            ProjectStatus status,
            int displayOrder
    ) {
        ProjectEntity entity = new ProjectEntity();
        entity.slug = slug;
        entity.name = name;
        entity.description = description;
        entity.status = status;
        entity.displayOrder = displayOrder;
        return entity;
    }
}
