DELETE FROM service_catalog_items
WHERE slug IN (
               'project-hub',
               'service-request',
               'admin-dashboard'
    );

INSERT INTO service_catalog_items (slug, name, description, status, display_order)
VALUES
    (
        'naru-calendar',
        'Naru Calendar',
        '일정을 관리하고 이후 Google Calendar와 동기화합니다.',
        'PLANNING',
        1
    ),
    (
        'naru-drive',
        'Naru Drive',
        '개인 파일을 저장하고 관리하는 공간입니다.',
        'NEXT',
        2
    ),
    (
        'naru-docs',
        'Naru Docs',
        '문서 작성과 편집을 위한 작업 공간입니다.',
        'NEXT',
        3
    ),
    (
        'naru-sheets',
        'Naru Sheets',
        '데이터를 정리하고 계산하는 스프레드시트입니다.',
        'NEXT',
        4
    )
    ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
                              description = EXCLUDED.description,
                              status = EXCLUDED.status,
                              display_order = EXCLUDED.display_order,
                              updated_at = CURRENT_TIMESTAMP;
