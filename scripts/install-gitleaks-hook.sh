#!/bin/sh
# 기억 레포에 pre-commit 훅을 심어 시크릿이 섞인 커밋을 막는다.
#   사용: scripts/install-gitleaks-hook.sh <기억레포경로>
#   필요: gitleaks (brew install gitleaks)
set -eu
REPO=$(cd "${1:?기억 레포 경로를 주세요}" && pwd)
command -v gitleaks > /dev/null || { echo "gitleaks 가 없습니다: brew install gitleaks"; exit 1; }
HOOK="$REPO/.git/hooks/pre-commit"
cat > "$HOOK" <<'HOOK'
#!/bin/sh
# 스테이징된 변경만 검사. 토큰·키·비밀번호 패턴이 있으면 커밋을 막는다.
exec gitleaks protect --staged --redact --verbose
HOOK
chmod +x "$HOOK"
echo "설치됨: $HOOK"
echo "오탐이면 레포 루트 .gitleaks.toml 의 [allowlist] 에 경로나 정규식을 추가하세요."
