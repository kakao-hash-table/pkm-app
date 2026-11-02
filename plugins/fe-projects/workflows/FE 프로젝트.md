## 최신화
팀원들의 PR 활동을 지금 다시 모으고, AI가 위키·지라·아지트와 레포를 읽어 이 레포 노트의 실행·배포·브랜치를 고쳐요.
- [활동] PR 활동 다시 모으기 · script: scripts/fe.mjs refresh --repo={repo} --group={group} --members={members} --api={github_api} --days={days} --dirs={repo_dirs} --exclude={exclude}
- [문서] 문서 찾고 노트 고치기 · agent(auto): prompts/조사.md

## 빼기
필요 없는 레포를 목록에서 빼요. 노트는 프로필 휴지통으로 가고, 다시 만들지 않게 "빼 둘 레포"에 더해요.
- [빼기] 목록에서 빼기 · script: scripts/fe.mjs remove --repo={repo} --group={group} --exclude={exclude}

## 레포 더하기
GitHub 레포를 직접 더해요. 노트를 만들고 AI가 실행·배포·브랜치를 채워요. "빼 둘 레포"에 있었으면 거기서 지워요.
- ok: 더하기
- [주소] GitHub 주소나 owner/name · ask: 예: https://github.daumkakao.com/webtech/place 또는 webtech/place
- [활동] 노트 만들기 · script: scripts/fe.mjs add --input={주소.answer} --group={group} --api={github_api} --dirs={repo_dirs} --exclude={exclude}
- [문서] 문서 찾고 노트 고치기 · agent(auto): prompts/조사.md

## 받기
처음이면 "받을 폴더"에 clone하고 노트의 로컬 줄을 채워요. 이미 있으면 fetch하고, 고친 파일 없이 뒤처졌으면 fast-forward해요.
- [받기] 레포 받기 · script: scripts/fe.mjs get --repo={repo} --group={group} --api={github_api} --clone_dir={clone_dir}

## 띄우기
노트의 실행 명령과 포트로 바로 띄워요. 다른 명령은 띄운 뒤 [명령 바꾸기].
- [띄우기] 개발 서버 띄우기 · script: scripts/devserver.mjs up --path={path} --command={command} --port={port}

## 멈추기
- [멈추기] 개발 서버 멈추기 · script: scripts/devserver.mjs stop --path={path}

## 배포
노트의 배포 줄에 있는 테스트 브랜치에 지금 브랜치를 머지해 올리거나, 운영 태그를 달아요. 고른 뒤 한 번 더 확인해요.
- [배포] 배포할 곳 고르고 올리기 · script: scripts/deploy.mjs run --path={path} --deploy={deploy} --repo={repo} --web={web}
