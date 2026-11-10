#!/bin/sh
# 야간 증류: 그날 대화 로그(chat/YYYY-MM-DD.jsonl)와 수집기 데이터를 journal/YYYY-MM-DD.md 한 장으로 압축하고,
# 지속 가치 있는 사실을 preferences/projects/open-loops/people 에 반영한 뒤 커밋한다.
#   사용: scripts/nightly-distill.sh [YYYY-MM-DD]   (기본 오늘)
#   크론: 30 23 * * * cd ~/soft-cyborg-starter && MEMORY_DIR=$HOME/soft-cyborg-starter/memory-template scripts/nightly-distill.sh >> /tmp/distill.log 2>&1
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
MEMORY_DIR=${MEMORY_DIR:-"$HERE/../memory-template"}
DAY=${1:-$(date +%F)}
cd "$MEMORY_DIR"

if [ -f "journal/$DAY.md" ]; then echo "[distill] journal/$DAY.md 이미 있음 — 건너뜀"; exit 0; fi
if [ ! -s "chat/$DAY.jsonl" ]; then echo "[distill] chat/$DAY.jsonl 없음 — 증류할 대화 없음"; exit 0; fi

PROMPT=$(sed "s/{{DAY}}/$DAY/g" "$HERE/prompts/nightly-distill.md")
unset CLAUDECODE
echo "[distill] $DAY 시작 $(date +%H:%M:%S)"
OUT=$(printf '%s' "$PROMPT" | claude -p --output-format json --permission-mode acceptEdits \
      --allowedTools 'Read,Edit,Write,Grep,Glob' --max-turns 40) || { echo "[distill] claude 실패"; exit 1; }
printf '%s' "$OUT" | python3 -c 'import json,sys
j = json.load(sys.stdin)
print("[distill]", "실패:" if j.get("is_error") else "완료:", str(j.get("result",""))[:600].replace("\n"," / "))
print(f"[distill] turns={j.get(\"num_turns\")} cost=${j.get(\"total_cost_usd\",0):.3f} {j.get(\"duration_ms\",0)//1000}s")'

[ -f "journal/$DAY.md" ] || { echo "[distill] 경고: journal/$DAY.md 가 생성되지 않았다"; exit 1; }
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  git add -A && git commit -qm "journal: $DAY 증류" && { git push -q 2>/dev/null || echo "[distill] push 실패(원격 없음?) — 로컬 커밋만"; }
fi
