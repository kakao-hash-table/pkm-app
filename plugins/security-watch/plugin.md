---
pkm_plugin: 1
id: security-watch
name: 보안 공지 대응
version: 0.1.0
author: pkm
permissions:
  ai: [chat, agent]
  agent_mode: auto
  bundled: [scripts/notice.mjs]
  secrets:
    - { name: AGIT_TOKEN, label: 아지트 토큰, hint: "아지트 API 토큰이에요. 공지 글을 읽기만 해요" }
settings:
  - { key: agit_api, label: 아지트 API 주소, default: "https://api.agit.in/v2" }
  - { key: agit_web, label: 아지트 주소, default: "https://kakao.agit.in", hint: "목록에서 공지 글로 바로 가는 링크를 만들 때 써요" }
  - { key: groups, label: 볼 그룹, default: "4", hint: "아지트 그룹 번호. 여럿이면 쉼표로 적어요. 4는 전사 공지 그룹이에요" }
  - { key: match, label: 공지 제목 규칙, default: "보안\\s*공지", hint: "글 첫 줄이 이 정규식에 맞는 것만 가져와요" }
  - { key: days, label: 며칠 전 글까지, default: "14" }
  - { key: projects, label: 점검할 프로젝트, type: lines, placeholder: "~/code/*", hint: "한 줄에 폴더 하나, 또는 폴더/*. 비우면 개발 도구 플러그인의 프로젝트 목록을 그대로 써요" }
  - { key: exclude, label: 뺄 프로젝트, type: lines, placeholder: "phocus", hint: "점검하지 않을 프로젝트 폴더 이름. 한 줄에 하나" }
  - { key: worktrees, label: 작업 폴더를 만들 곳, type: path, default: "~/.pkm-worktrees/security", hint: "공지마다 이 아래에 폴더를 하나 만들고, 고칠 레포의 git worktree를 그 안에 둬요. 내가 쓰는 저장소 폴더는 건드리지 않아요" }
---

사내 아지트에 보안 공지가 올라오면 가져와서, AI가 FE 프로젝트에 영향이 있는지 먼저 판단해요. 영향이 있으면 에이전트가 내 프로젝트를 하나씩 점검하고, 고칠 곳은 레포마다 작업 폴더(git worktree)에 로컬 브랜치를 만들어 수정·테스트·커밋해 둬요. 결과는 레포마다 무엇이 문제였고 어떻게 고쳤는지로 보여 줘요. push와 PR은 하지 않아요. 결과를 보고 내가 올려요.
