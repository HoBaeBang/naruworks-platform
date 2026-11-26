#!/usr/bin/env bash
set -euo pipefail

planning_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
reference_doc="$planning_dir/_templates/reference.docx"

pandoc_bin=/opt/homebrew/bin/pandoc
if [[ ! -x "$pandoc_bin" ]]; then
  pandoc_bin=$(command -v pandoc) || {
    printf 'pandoc 실행 파일을 찾을 수 없습니다.\n' >&2
    exit 1
  }
fi

# 기획 폴더를 기준으로 Markdown 원본과 Word 출력 경로를 지정한다.
while read -r source_path output_path; do
  document_dir="$planning_dir/${source_path%/*}"

  "$pandoc_bin" "$planning_dir/$source_path" \
    --reference-doc="$reference_doc" \
    --resource-path="$document_dir" \
    --output="$planning_dir/$output_path" </dev/null
  printf '%s\n' "$output_path"
done <<'DOCX_TARGETS'
prd/PRD.md prd/PRD.docx
frd/FRD.md frd/FRD.docx
business-rules/BR.md business-rules/Business-Rules.docx
nfr/NFR.md nfr/NFR.docx
acceptance-criteria/AC.md acceptance-criteria/Acceptance-Criteria.docx
DOCX_TARGETS
