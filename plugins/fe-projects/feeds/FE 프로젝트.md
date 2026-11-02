## FE 프로젝트
레포마다 실행·배포·브랜치를 한 줄씩 보여요. 줄을 누르면 GitHub 레포가 열리고, 자세한 건 지식 › 맥락노트의 노트에 있어요. 필요 없는 레포는 [빼기].
- run: scripts/fe.mjs list --group={group} --members={members} --api={github_api} --days={days} --dirs={repo_dirs} --exclude={exclude}
- every: 60
- count: no
- view: inline
- start: 최신화, 받기, 띄우기, 멈추기, 배포, 빼기
- start_label: 최신화
- empty: 아직 레포가 없어요. 플러그인 설정의 "팀원"에 GitHub 아이디를 적거나 [레포 더하기]로 더해 주세요

## 레포 더하기
팀원 PR로 잡히지 않는 레포를 GitHub 주소로 직접 더해요.
- run: scripts/fe.mjs add-item
- every: 1440
- count: no
- view: inline
- start: 레포 더하기
- start_label: 더하기
