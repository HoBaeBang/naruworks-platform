package com.naruworks.core.service;

import com.naruworks.domain.model.Project;
import com.naruworks.domain.model.ServiceCatalogItem;
import com.naruworks.domain.type.ProjectStatus;
import com.naruworks.domain.type.ServiceStatus;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {

    public List<Project> findPublicProjects() {
        return List.of(
                Project.of(
                        "naruworks-platform",
                        "NaruWorks Platform",
                        "개인 홈서버 위에서 여러 서비스를 운영하기 위한 플랫폼",
                        ProjectStatus.PHASE_1
                ),
                Project.of(
                        "stablepay-network",
                        "StablePay Network",
                        "결제, 원장, 정산 도메인을 검증하는 기준 구현",
                        ProjectStatus.EXTERNAL_MODULE
                )
        );
    }

    public List<ServiceCatalogItem> findPublicServices() {
        return List.of(
                ServiceCatalogItem.of(
                        "project-hub",
                        "Project Hub",
                        "프로젝트와 포트폴리오를 한곳에서 보여주는 공개 허브",
                        ServiceStatus.PLANNING
                ),
                ServiceCatalogItem.of(
                        "service-request",
                        "Service Request",
                        "지인이나 사용자가 필요한 서비스를 요청하는 접수 흐름",
                        ServiceStatus.NEXT
                ),
                ServiceCatalogItem.of(
                        "admin-dashboard",
                        "Admin Dashboard",
                        "서비스 상태와 요청을 관리하는 관리자 화면",
                        ServiceStatus.SKELETON
                )
        );
    }
}
