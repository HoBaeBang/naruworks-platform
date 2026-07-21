package com.naruworks.api.controller;


import com.naruworks.domain.type.ProjectStatus;
import com.naruworks.domain.type.ServiceStatus;
import com.naruworks.infrastructure.persistence.catalog.ProjectEntity;
import com.naruworks.infrastructure.persistence.catalog.ProjectJpaRepository;
import com.naruworks.infrastructure.persistence.catalog.ServiceCatalogItemEntity;
import com.naruworks.infrastructure.persistence.catalog.ServiceCatalogItemJpaRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;


import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureMockMvc
public class CatalogApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ProjectJpaRepository projectJpaRepository;

    @Autowired
    private ServiceCatalogItemJpaRepository serviceCatalogItemJpaRepository;

    @BeforeEach
    void setUp() {
        projectJpaRepository.deleteAll();
        serviceCatalogItemJpaRepository.deleteAll();

        projectJpaRepository.save(ProjectEntity.of(
                "stablepay-network",
                "StablePay Network",
                "결제, 원장, 정산 도메인을 검증하는 기준 구현",
                ProjectStatus.EXTERNAL_MODULE,
                2
        ));

        projectJpaRepository.save(ProjectEntity.of(
                "naruworks-platform",
                "NaruWorks Platform",
                "개인 홈서버 위에서 여러 서비스를 운영하기 위한 플랫폼",
                ProjectStatus.PHASE_1,
                1
        ));

        serviceCatalogItemJpaRepository.save(ServiceCatalogItemEntity.of(
                "naru-drive",
                "Naru Drive",
                "파일 저장/관리 서비스",
                ServiceStatus.NEXT,
                2
        ));

        serviceCatalogItemJpaRepository.save(ServiceCatalogItemEntity.of(
                "naru-calendar",
                "Naru Calendar",
                "일정관리 서비스",
                ServiceStatus.PLANNING,
                1
        ));
    }

    @Test
    @DisplayName("프로젝트 목록 API는 display_order 오름차순으로 프로젝트를 반환한다")
    void getProjects() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/projects"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value("naruworks-platform"))
                .andExpect(jsonPath("$[0].name").value("NaruWorks Platform"))
                .andExpect(jsonPath("$[0].status").value("PHASE_1"))
                .andExpect(jsonPath("$[1].slug").value("stablepay-network"))
                .andExpect(jsonPath("$[1].status").value("EXTERNAL_MODULE"));
    }

    @Test
    @DisplayName("서비스 목록 API는 display_order 오름차순으로 서비스를 반환한다")
    void getServices() throws Exception {
        mockMvc.perform(MockMvcRequestBuilders.get("/api/services"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value("naru-calendar"))
                .andExpect(jsonPath("$[0].name").value("Naru Calendar"))
                .andExpect(jsonPath("$[0].status").value("PLANNING"))
                .andExpect(jsonPath("$[1].slug").value("naru-drive"))
                .andExpect(jsonPath("$[1].status").value("NEXT"));
    }
}
