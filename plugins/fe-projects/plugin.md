---
pkm_plugin: 1
id: fe-projects
name: FE 프로젝트 관리
version: 0.2.0
author: pkm
permissions:
  ai: [agent]
  agent_mode: auto
  bundled: [scripts/fe.mjs, scripts/devserver.mjs, scripts/deploy.mjs]
  secrets:
    - { name: GITHUB_TOKEN, label: GitHub 토큰, hint: "PR 활동을 읽을 토큰. classic이면 repo, fine-grained면 Pull requests·Metadata 읽기면 돼요. 코드 리뷰 플러그인과 같은 토큰을 써요", url: "https://github.com/settings/tokens" }
settings:
  - { key: github_api, label: GitHub API 주소, hint: "github.com이면 그대로 두세요. 회사 GitHub(Enterprise)면 https://<주소>/api/v3", default: "https://api.github.com" }
  - { key: members, label: 팀원, type: lines, placeholder: "hash-table", hint: "GitHub 아이디를 한 줄에 하나. 이 사람들이 PR을 올린 레포를 모아요. hash.table처럼 점이 있으면 hash-table로 찾아요" }
  - { key: days, label: 볼 기간(일), default: "183", hint: "오늘부터 며칠 전까지의 PR을 볼지. 기본은 반년" }
  - { key: repo_dirs, label: 로컬 클론 폴더, type: lines, placeholder: "~/code/*", hint: "레포를 받아 둔 폴더. 폴더/*로 적으면 그 아래 폴더를 모두 봐요. origin 주소로 레포와 짝지어요" }
  - { key: clone_dir, label: 받을 폴더, type: path, default: "~/code", hint: "[받기]로 처음 받는 레포를 이 아래에 둬요. 노트 폴더 밖이어야 해요(노트는 GitHub로 동기화될 수 있어요)" }
  - { key: exclude, label: 빼 둘 레포, type: lines, placeholder: "gitops/*", hint: "새 노트를 만들지 않을 레포. owner/name, *를 쓸 수 있어요. [빼기]가 여기에 더하고 [레포 더하기]가 여기서 지워요" }
  - { key: group, label: 노트 묶음, default: "FE 프로젝트", hint: "레포마다 맥락노트를 이 묶음에 둬요. 개발 도구 플러그인도 이 묶음을 읽어요" }
---

팀이 손대는 FE 레포를 레포마다 맥락노트 하나로 관리해요. 노트에는 로컬 실행·배포·브랜치 전략·지라 프로젝트를 한두 줄씩 적어 두고, 목록에서 한눈에 봐요. 하루 한 번 팀원들의 GitHub PR을 모아 레포별 활동을 고치고, 처음 보는 레포는 노트를 만들어요. [최신화]를 누르면 활동을 바로 다시 모으고, AI가 위키·지라·아지트와 레포를 읽고 그 레포 노트를 고쳐요. 문서에 없으면 최근 PR·커밋에서 사람들이 실제로 한 방식을 적고 '관례'라고 표시해요. 필요 없는 레포는 [빼기]로 빼고, PR로 잡히지 않는 레포는 [레포 더하기]에 GitHub 주소를 적어 더해요.

레포 줄마다 [받기](처음이면 clone, 있으면 fetch·fast-forward) · [띄우기]·[멈추기](노트의 실행 명령·포트, 개발 도구와 같은 상태) · [배포](노트의 배포 줄에 있는 테스트 브랜치에 머지해 push, 또는 운영 태그 vYY.MM.DD push — 고르고 한 번 더 확인한 것만, force push 없음)를 눌러요. 코드는 "받을 폴더"(노트 밖)에만 받아요.

AI는 노트만 고쳐요. 레포 파일, 위키·지라·아지트에는 쓰지 않아요.
