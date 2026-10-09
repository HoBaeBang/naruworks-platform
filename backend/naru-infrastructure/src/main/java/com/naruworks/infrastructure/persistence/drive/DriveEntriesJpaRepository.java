package com.naruworks.infrastructure.persistence.drive;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface DriveEntriesJpaRepository extends JpaRepository<DriveEntriesEntity, Long> {

    Optional<DriveEntriesEntity> findByIdAndOwnerMemberIdAndDeletedAtIsNull(Long Id, Long ownerMemberId);

    @Query("""
    select entry
    from DriveEntriesEntity entry
    where entry.ownerMemberId = :ownerMemberId
      and entry.deletedAt is null
      and (
          (:parentId is null and entry.parentId is null)
          or entry.parentId = :parentId
      )
    order by
      case
          when entry.entryType =
              com.naruworks.domain.type.DriveEntryType.FOLDER
          then 0
          else 1
      end,
      entry.name asc
    """)
    List<DriveEntriesEntity> findActiveChildren(
            Long ownerMemberId,
            Long parentId
    );
}
