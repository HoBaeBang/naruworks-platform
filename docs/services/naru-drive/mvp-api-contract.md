# Naru Drive MVP API 계약

모든 API는 로그인한 회원을 서버 세션에서 식별한다. 요청 body에 `memberId`를 받지 않는다.

## 목록과 폴더

| API | 설명 | MVP 권한 |
| --- | --- | --- |
| `GET /api/drive/entries?parentId={id}` | 루트 또는 특정 폴더의 활성 항목 목록 | 폴더 소유자 |
| `POST /api/drive/folders` | 폴더 생성 | 상위 폴더 소유자 |
| `PATCH /api/drive/entries/{entryId}` | 이름 변경 또는 이동 | entry·새 상위 폴더 소유자 |
| `POST /api/drive/entries/{entryId}/trash` | 파일 또는 폴더를 휴지통으로 이동 | entry 소유자 |
| `GET /api/drive/trash` | 휴지통 항목 목록 | 소유자 |
| `POST /api/drive/entries/{entryId}/restore` | 휴지통 항목 복원 | entry 소유자 |

### `GET /api/drive/entries`

`parentId`가 없으면 개인 루트를 조회한다. 응답에는 파일과 폴더를 이름 오름차순으로 반환하되, 폴더를 먼저 둔다.

```json
{
  "parent": null,
  "entries": [
    {
      "id": 12,
      "type": "FOLDER",
      "name": "여행",
      "updatedAt": "2026-10-07T12:30:00+09:00"
    },
    {
      "id": 13,
      "type": "FILE",
      "name": "계획.pdf",
      "sizeBytes": 481220,
      "contentType": "application/pdf",
      "updatedAt": "2026-10-07T12:35:00+09:00"
    }
  ]
}
```

### `POST /api/drive/folders`

```json
{
  "parentId": 12,
  "name": "2026년 가을"
}
```

`parentId`는 생략 또는 `null`일 수 있다. 현재 루트에 만들겠다는 의미다.

## 파일 전송

| API | 설명 | MVP 권한 |
| --- | --- | --- |
| `POST /api/drive/files` | multipart 파일 업로드 | 상위 폴더 소유자 |
| `GET /api/drive/files/{entryId}/download` | Content-Disposition 첨부 다운로드 | 파일 소유자 |

### `POST /api/drive/files`

`multipart/form-data`로 `parentId`와 `file`을 받는다. 파일은 backend가 RustFS로 스트리밍하고, 성공 뒤에만 `AVAILABLE` 상태로 목록에 보인다.

| 실패 조건 | 응답 |
| --- | --- |
| 로그인하지 않음 | `401` |
| 상위 폴더가 없거나 타인 소유 | `404` |
| 상위 항목이 파일 | `400` |
| 이름이 비었거나 정책 위반 | `400` |
| 동일 이름 존재 | `409` |
| 50 MB 초과 또는 quota 초과 | `413` |
| RustFS 업로드 실패 | `502` 또는 `503`, `PENDING`을 `FAILED`로 기록 |

## API 공통 규칙

- 목록·상세·다운로드는 타인 소유 항목에 `404`를 반환한다.
- `deleted_at IS NOT NULL` 항목은 기본 목록·다운로드·이동 대상에서 제외한다.
- 파일명과 오류 메시지에는 서버 파일 경로나 RustFS 접근 키를 노출하지 않는다.
- 공유와 공유 링크 API는 별도 이슈에서 추가한다.
