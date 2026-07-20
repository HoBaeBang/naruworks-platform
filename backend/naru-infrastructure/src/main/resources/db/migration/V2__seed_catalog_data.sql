INSERT INTO projects (slug, name, description, status, display_order)
VALUES
    (
        'naruworks-platform',
        'NaruWorks Platform',
        '개인 홈서버 위에서 여러 서비스를 운영하기 위한 플랫폼',
        'PHASE_1',
        1
    ),
    (
        'stablepay-network',
        'StablePay Network',
        '결제, 원장, 정산 도메인을 검증하는 기준 구현',
        'EXTERNAL_MODULE',
        2
    )
    ON CONFLICT (slug) DO NOTHING;

INSERT INTO service_catalog_items (slug, name, description, status, display_order)
VALUES
    (
        'project-hub',
        'Project Hub',
        '프로젝트와 포트폴리오를 한곳에서 보여주는 공개 허브',
        'PLANNING',
        1
    ),
    (
        'service-request',
        'Service Request',
        '지인이나 사용자가 필요한 서비스를 요청하는 접수 흐름',
        'NEXT',
        2
    ),
    (
        'admin-dashboard',
        'Admin Dashboard',
        '서비스 상태와 요청을 관리하는 관리자 화면',
        'SKELETON',
        3
    )
    ON CONFLICT (slug) DO NOTHING;
