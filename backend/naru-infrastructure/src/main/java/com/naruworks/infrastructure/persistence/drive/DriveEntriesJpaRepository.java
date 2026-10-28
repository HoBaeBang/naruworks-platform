package com.naruworks.infrastructure.persistence.drive;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface DriveEntriesJpaRepository extends JpaRepository<DriveEntriesEntity, Long> {

    Optional<DriveEntriesEntity> findByIdAndOwnerMemberIdAndDeletedAtIsNull(Long id, Long ownerMemberId);

    boolean existsByOwnerMemberIdAndParentIdAndNameAndDeletedAtIsNull(
            Long ownerMemberId,
            Long parentId,
            String name
    );

    /**
     * 소유자의 활성 항목 중 지정한 부모의 바로 아래 항목을 조회한다.
     * parentId가 없으면 루트 항목을, 있으면 해당 폴더의 자식 항목을 조회하며 폴더를 파일보다 먼저 이름순으로 정렬한다.
     */
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
            @Param("ownerMemberId") Long ownerMemberId,
            @Param("parentId") Long parentId
    );
}
