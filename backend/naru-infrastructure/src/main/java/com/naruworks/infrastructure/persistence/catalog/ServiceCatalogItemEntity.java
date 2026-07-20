package com.naruworks.infrastructure.persistence.catalog;

import com.naruworks.domain.model.ServiceCatalogItem;
import com.naruworks.domain.type.ServiceStatus;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(name = "service_catalog_items")
public class ServiceCatalogItemEntity {

    /** 서비스 카탈로그 테이블의 내부 식별자 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** URL과 API에서 사용하는 서비스 고유 식별자 */
    private String slug;

    /** 공개 화면에 표시할 서비스 이름 */
    private String name;

    /** 서비스의 목적과 내용을 설명하는 문구 */
    private String description;

    /** 서비스의 현재 준비 또는 운영 상태 */
    @Enumerated(EnumType.STRING)
    private ServiceStatus status;

    /** 공개 목록에서 서비스를 보여줄 정렬 순서 */
    @Column(name = "display_order")
    private int displayOrder;

    public ServiceCatalogItem toDomain() {
        return ServiceCatalogItem.of(slug, name, description, status);
    }
}
