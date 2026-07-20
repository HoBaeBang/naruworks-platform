COMMENT ON TABLE projects IS 'NaruWorks 공개 프로젝트 카탈로그';
COMMENT ON COLUMN projects.id IS '프로젝트 테이블의 내부 식별자';
COMMENT ON COLUMN projects.slug IS 'URL과 API에서 사용하는 프로젝트 고유 식별자';
COMMENT ON COLUMN projects.name IS '공개 화면에 표시할 프로젝트 이름';
COMMENT ON COLUMN projects.description IS '프로젝트의 목적과 내용을 설명하는 문구';
COMMENT ON COLUMN projects.status IS '프로젝트의 현재 진행 또는 연결 상태';
COMMENT ON COLUMN projects.display_order IS '공개 목록에서 프로젝트를 보여줄 정렬 순서';
COMMENT ON COLUMN projects.created_at IS '프로젝트 row가 최초 생성된 시각';
COMMENT ON COLUMN projects.updated_at IS '프로젝트 row가 마지막으로 수정된 시각';

COMMENT ON TABLE service_catalog_items IS 'NaruWorks 공개 서비스 카탈로그';
COMMENT ON COLUMN service_catalog_items.id IS '서비스 카탈로그 테이블의 내부 식별자';
COMMENT ON COLUMN service_catalog_items.slug IS 'URL과 API에서 사용하는 서비스 고유 식별자';
COMMENT ON COLUMN service_catalog_items.name IS '공개 화면에 표시할 서비스 이름';
COMMENT ON COLUMN service_catalog_items.description IS '서비스의 목적과 내용을 설명하는 문구';
COMMENT ON COLUMN service_catalog_items.status IS '서비스의 현재 준비 또는 운영 상태';
COMMENT ON COLUMN service_catalog_items.display_order IS '공개 목록에서 서비스를 보여줄 정렬 순서';
COMMENT ON COLUMN service_catalog_items.created_at IS '서비스 row가 최초 생성된 시각';
COMMENT ON COLUMN service_catalog_items.updated_at IS '서비스 row가 마지막으로 수정된 시각';
