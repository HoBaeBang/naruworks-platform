package com.naruworks.core.port;

import com.naruworks.domain.model.DriveFile;

import java.util.Collection;
import java.util.Map;

public interface DriveFileReader {

    Map<Long, DriveFile> findByDriveEntryIds(Collection<Long> driveEntryIds);
}
