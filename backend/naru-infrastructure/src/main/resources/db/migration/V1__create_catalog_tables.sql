CREATE TABLE projects (
                          id BIGSERIAL PRIMARY KEY,
                          slug VARCHAR(100) NOT NULL UNIQUE,
                          name VARCHAR(200) NOT NULL,
                          description TEXT NOT NULL,
                          status VARCHAR(50) NOT NULL,
                          display_order INTEGER NOT NULL DEFAULT 0,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_catalog_items (
                                       id BIGSERIAL PRIMARY KEY,
                                       slug VARCHAR(100) NOT NULL UNIQUE,
                                       name VARCHAR(200) NOT NULL,
                                       description TEXT NOT NULL,
                                       status VARCHAR(50) NOT NULL,
                                       display_order INTEGER NOT NULL DEFAULT 0,
                                       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                                       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
