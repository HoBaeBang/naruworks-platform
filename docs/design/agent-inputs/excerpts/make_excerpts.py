#!/usr/bin/env python3
"""화면별 문서 발췌(C3) 생성기. 표준 라이브러리만 쓴다.

원본 두 문서에서 WF-NN 절만 잘라 excerpts/WF-NN.md로 쓴다. 원본은 고치지 않는다.
  - screen-data-actions.md: 「1. 공통 헤더/푸터」 절 + 「### WF-NN …」 절
  - screens.md: 「#### WF-NN …」 구성 근거 절(있으면)

사용:
  python3 make_excerpts.py <screen-data-actions.md> <screens.md> [출력 폴더]
원본이 바뀌면 다시 실행한다(디자인 봇 규칙 C7).
"""
import hashlib
import re
import sys
from pathlib import Path


def section(text: str, start_pat: str, level: int) -> str:
    """start_pat로 시작하는 제목부터 같은 수준 이상의 다음 제목 직전까지."""
    lines = text.splitlines()
    out, on = [], False
    for ln in lines:
        m = re.match(r"^(#{1,6}) ", ln)
        if on and m and len(m.group(1)) <= level:
            break
        if not on and re.match(start_pat, ln):
            on = True
        if on:
            out.append(ln)
    return "\n".join(out).strip()


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def main() -> int:
    sda, scr = Path(sys.argv[1]), Path(sys.argv[2])
    outdir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).parent
    a, b = sda.read_text(encoding="utf-8"), scr.read_text(encoding="utf-8")
    common = section(a, r"^## 1\. 공통 헤더/푸터", 2)
    common = re.sub(r"(?m)^(#{1,5}) ", r"#\1 ", common)  # 발췌 안에서 한 단계 낮춘다
    for n in range(1, 17):
        wf = f"WF-{n:02d}"
        data = section(a, rf"^### {wf}\b", 3)
        basis = section(b, rf"^#### {wf}\b", 4)
        if not data:
            print(f"skip {wf}: screen-data 절 없음")
            continue
        body = [
            f"# {wf} 발췌 (자동 생성 · 직접 고치지 말 것)",
            "",
            f"- 원본: `{sda.name}` (sha256 {sha(sda)}), `{scr.name}` (sha256 {sha(scr)})",
            "- 원본이 바뀌면 `make_excerpts.py`로 다시 만든다. 원본과 다르면 원본이 우선이다.",
            "",
            "## A. 화면 데이터·동작·상태 (screen-data-actions.md)",
            "",
            data.replace(f"### {wf}", f"### {wf}", 1),
            "",
            "## B. 구성 근거 (screens.md, 있으면)",
            "",
            basis or "_(screens.md에 이 화면의 구성 근거 절이 아직 없음)_",
            "",
            "## C. 공통 헤더/푸터 (screen-data-actions.md 1장)",
            "",
            common,
            "",
        ]
        (outdir / f"{wf}.md").write_text("\n".join(body), encoding="utf-8")
        print(f"wrote {wf}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
