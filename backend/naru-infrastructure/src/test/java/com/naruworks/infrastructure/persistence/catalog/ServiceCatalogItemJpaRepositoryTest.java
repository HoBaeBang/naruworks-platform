package com.naruworks.infrastructure.persistence.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import com.naruworks.domain.type.ServiceStatus;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class ServiceCatalogItemJpaRepositoryTest {

    @Autowired
    private ServiceCatalogItemJpaRepository serviceCatalogItemJpaRepository;

    @Test
    @DisplayName("서비스 카탈로그를 display_order 오름차순으로 조회한다")
    void findAllByOrderByDisplayOrderAsc() {
        serviceCatalogItemJpaRepository.save(ServiceCatalogItemEntity.of(
                "naru-video",
                "Naru Video",
                "홈서버 기반 비디오 플랫폼",
                ServiceStatus.SKELETON,
                3
        ));
        serviceCatalogItemJpaRepository.save(ServiceCatalogItemEntity.of(
                "naru-calendar",
                "Naru Calendar",
                "일정관리 서비스",
                ServiceStatus.PLANNING,
                1
        ));
        serviceCatalogItemJpaRepository.save(ServiceCatalogItemEntity.of(
                "naru-drive",
                "Naru Drive",
                "파일 저장/관리 서비스",
                ServiceStatus.NEXT,
                2
        ));

        List<ServiceCatalogItemEntity> services =
                serviceCatalogItemJpaRepository.findAllByOrderByDisplayOrderAsc();

        assertThat(services)
                .extracting(ServiceCatalogItemEntity::getSlug)
                .containsExactly("naru-calendar", "naru-drive", "naru-video");

        assertThat(services.get(0).getStatus()).isEqualTo(ServiceStatus.PLANNING);
        assertThat(services.get(0).getName()).isEqualTo("Naru Calendar");
        assertThat(services.get(0).getDescription()).isEqualTo("일정관리 서비스");
    }
}
