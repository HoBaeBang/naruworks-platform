package com.naruworks.infrastructure.persistence.drive;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.time.LocalDateTime;

public interface DriveEntriesJpaRepository extends JpaRepository<DriveEntriesEntity, Long> {

    /**
     * 지정한 소유자의 활성 항목만 이름과 변경 시각을 갱신한다.
     * 벌크 갱신 전 변경 사항을 반영하고 이후 영속성 컨텍스트를 비워 오래된 엔티티를 사용하지 않는다.
     * @return 갱신된 행 수
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update DriveEntriesEntity entry
            set entry.name = :name, entry.updatedAt = :updatedAt
            where entry.id = :id and entry.ownerMemberId = :ownerId and entry.deletedAt is null
            """)
    int renameActive(@Param("id") Long id, @Param("ownerId") Long ownerId,
                     @Param("name") String name, @Param("updatedAt") LocalDateTime updatedAt);

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
