#!/bin/sh
# PKM을 이 컴퓨터에서만(127.0.0.1) 띄운다 — 고친 내용이 데이터 폴더의 <프로필>/ 마크다운 파일에 바로 저장된다.
#   scripts/serve.sh [포트]                     데이터는 ./data
#   PKM_DATA=../my-notes scripts/serve.sh       데이터 폴더를 따로 둘 때(권장)
# 저장 위치를 GitHub로 정한 프로필은 데이터 폴더가 속한 git 저장소에 서버가 자동으로 커밋·푸시한다.
cd "$(dirname "$0")/.."
PORT="${1:-5270}"
echo "브라우저에서 http://localhost:$PORT 를 여세요 (끝내려면 Ctrl+C)"
PORT="$PORT" HOST=127.0.0.1 exec node server/index.js
