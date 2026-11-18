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

# README 표에서 폴더, Markdown 파일명, Word 파일명을 읽는다.
docx_row='^[[:blank:]]*\|[[:blank:]]*([[:alnum:]_-]+)[[:blank:]]*\|[[:blank:]]*([[:alnum:]_.-]+\.md)[[:blank:]]*→[[:blank:]]*([[:alnum:]_.-]+\.docx)[[:blank:]]*\|'
converted=0
while IFS= read -r row || [[ -n "$row" ]]; do
  if [[ "$row" =~ $docx_row ]]; then
    folder=${BASH_REMATCH[1]}
    source_file=${BASH_REMATCH[2]}
    output_file=${BASH_REMATCH[3]}
    document_dir="$planning_dir/$folder"

    "$pandoc_bin" "$document_dir/$source_file" \
      --reference-doc="$reference_doc" \
      --resource-path="$document_dir" \
      --output="$document_dir/$output_file" </dev/null
    printf '%s/%s\n' "$folder" "$output_file"
    converted=$((converted + 1))
  fi
done < "$planning_dir/README.md"

if [[ "$converted" -eq 0 ]]; then
  printf 'README.md 표에서 Word 변환 대상을 찾을 수 없습니다.\n' >&2
  exit 1
fi
