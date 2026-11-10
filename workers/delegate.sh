#!/bin/sh
# 1분 넘게 걸릴 일을 백그라운드 claude 세션에 맡긴다.
#   사용: workers/delegate.sh <레포경로> "<할 일>"
#   내부: workers/delegate.sh --run <워크트리> <브랜치> "<할 일>"  (nohup 으로 재호출되는 워커 본체)
# 끝나면 SLACK_BOT_TOKEN·SLACK_OWNER_ID 가 있을 때 DM 으로, 없으면 stdout 으로 요약을 알린다.
set -eu

notify() {
  if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_OWNER_ID:-}" ]; then
    printf '%s' "$1" | python3 -c 'import json,sys,os; print(json.dumps({"channel": os.environ["SLACK_OWNER_ID"], "text": sys.stdin.read()}))' |
      curl -sS -X POST https://slack.com/api/chat.postMessage \
        -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-Type: application/json; charset=utf-8' \
        --data-binary @- > /dev/null
  else
    printf '%s\n' "$1"
  fi
}

if [ "${1:-}" = "--run" ]; then
  WT=$2; BRANCH=$3; TASK=$4
  cd "$WT"
  unset CLAUDECODE  # Claude Code 안에서 실행됐을 때 중첩 세션 거부 방지
  PROMPT="질문할 사람이 없다. 합리적 기본값으로 스스로 결정하고 끝까지 진행하라.
이 디렉토리는 git 워크트리(브랜치 $BRANCH)다. 작업을 마치면 커밋하고 'git push -u origin $BRANCH' 하라.
마지막 메시지는 3줄 요약: 무엇을 했는지 / 어디에 있는지(브랜치·파일) / 어떻게 검증했는지.

작업: $TASK"
  OUT=$(printf '%s' "$PROMPT" | claude -p --output-format json --permission-mode acceptEdits \
        --allowedTools 'Read,Edit,Write,Grep,Glob,Bash(git *),Bash(npm *),Bash(python3 *)' 2>>"$WT.log") || true
  SUMMARY=$(printf '%s' "$OUT" | python3 -c 'import json,sys
try:
    j = json.load(sys.stdin); print(("실패: " if j.get("is_error") else "") + str(j.get("result",""))[:1500])
except Exception: print("(결과 JSON 파싱 실패 — 로그를 확인하세요)")')
  notify "[worker 완료] $BRANCH
$SUMMARY
로그: $WT.log"
  exit 0
fi

REPO=$(cd "$1" && pwd); TASK=$2
SLUG=$(date +%m%d-%H%M)-$(printf '%s' "$TASK" | tr -cs '[:alnum:]' '-' | cut -c1-30 | tr '[:upper:]' '[:lower:]' | sed 's/-*$//')
BRANCH="agent/$SLUG"
WT="$REPO/.worktrees/$SLUG"
mkdir -p "$REPO/.worktrees"
git -C "$REPO" worktree add -q -b "$BRANCH" "$WT" HEAD
grep -qx '.worktrees/' "$REPO/.gitignore" 2>/dev/null || echo '.worktrees/' >> "$REPO/.gitignore"

nohup "$0" --run "$WT" "$BRANCH" "$TASK" > "$WT.log" 2>&1 &
echo "맡겼어요. 브랜치 $BRANCH · 로그 $WT.log"
