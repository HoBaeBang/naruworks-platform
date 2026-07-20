package com.naruworks.core.port;

import com.naruworks.domain.model.Project;
import com.naruworks.domain.model.ServiceCatalogItem;
import java.util.List;

public interface CatalogReader {

    List<Project> findPublicProjects();

    List<ServiceCatalogItem> findPublicServices();
}
