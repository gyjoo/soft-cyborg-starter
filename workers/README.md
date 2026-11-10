# workers/ — 1분 넘는 일은 백그라운드 claude 세션에 위임

브리지는 "대화" 담당이다. 턴 하나가 5분씩 걸리면 그동안 다른 메시지가 전부 막힌다 (동시성 1).
그래서 코드 수정·조사·보고서처럼 오래 걸리는 일은 **별도 claude 프로세스**에 넘기고, 브리지는 바로
"맡겼어요" 라고 답한 뒤 다음 메시지를 받는다. 끝나면 워커가 결과를 슬랙 DM 으로 알린다.

## 패턴

1. **격리된 작업 공간**: `git worktree add` 로 브랜치 하나를 따서 그 안에서만 작업. 내 작업 트리는 건드리지 않는다.
2. **`claude -p` 를 nohup 으로 백그라운드 실행**: 부모(브리지)가 죽어도 워커는 끝까지 돈다.
3. **프롬프트에 종료 조건을 명시**: "커밋하고 푸시하라, 질문하지 말고 기본값으로 결정하라, 마지막 메시지는 3줄 요약".
4. **완료 알림**: 결과 JSON 의 `result` 필드 앞부분을 슬랙 DM 으로. 실패해도 로그 경로를 알린다.
5. **권한은 좁게**: `--permission-mode acceptEdits` + `--allowedTools` 로 git·npm 정도만 쉘 허용.

## 사용

```sh
# .env 의 SLACK_BOT_TOKEN / SLACK_OWNER_ID 가 있으면 완료 알림이 DM 으로 간다 (없으면 stdout).
set -a; . ../bridge/.env; set +a
workers/delegate.sh ~/Dev/my-repo "README 의 설치 절을 최신 Node 24 기준으로 다시 쓰고, 깨진 링크 고쳐"
```

출력: 브랜치명과 로그 파일 경로. 끝나면 DM 으로 요약이 온다. 결과는 `git -C ~/Dev/my-repo worktree list` 로 확인하고,
마음에 들면 머지, 아니면 `git worktree remove` 로 버린다.

## 브리지에서 호출하려면

기억 레포 `CLAUDE.md` 에 한 줄 추가하면 비서가 알아서 위임한다:

> 1분 넘게 걸릴 코드 작업·조사는 직접 하지 말고 `<레포>/workers/delegate.sh <대상레포> "<작업>"` 을 Bash 로 실행해 위임하고,
> 사용자에게는 "맡겼어요, 끝나면 DM 드릴게요" 라고만 답하라.

그러려면 브리지의 `--permission-mode acceptEdits` 만으로는 Bash 가 막히므로 `index.js` 의 args 에
`'--allowedTools', 'Bash(*/workers/delegate.sh *)'` 를 추가한다.

## 배운 것

- 워커가 묻는 순간 멈춘다. "질문할 사람이 없다" 를 프롬프트 첫 줄에 쓰는 게 제일 효과적이었다.
- 완료 알림이 유실될 수 있으니(네트워크·재부팅), 워커는 **결과를 반드시 git 에 남긴다**. 알림은 보조 수단이다.
- 워크트리는 쌓인다. 주 1회 `git worktree prune` + 머지된 브랜치 삭제 크론을 두면 디스크가 안 찬다.
