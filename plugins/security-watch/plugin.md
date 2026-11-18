---
pkm_plugin: 1
id: security-watch
name: 보안 공지 대응
version: 0.2.4
author: pkm
permissions:
  ai: [chat, agent]
  agent_mode: auto
  bundled: [scripts/notice.mjs, scripts/ship.mjs]
  secrets:
    - { name: AGIT_TOKEN, label: 아지트 토큰, hint: "아지트 API 토큰이에요. 공지 글을 읽기만 해요" }
    - { name: JIRA_TOKEN, label: Jira 토큰, hint: "레포의 [티켓 만들고 PR 올리기]를 누르면 그 레포의 티켓을 만들 때 써요. Jira Cloud는 API 토큰이에요", url: "https://id.atlassian.com/manage-profile/security/api-tokens" }
    - { name: GITHUB_TOKEN, label: GitHub 토큰, hint: "PR을 만들고 담당자를 넣을 때 써요. classic 토큰이면 repo 권한을 주세요. push는 이 컴퓨터의 git 로그인으로 해요" }
settings:
  - { key: agit_api, label: 아지트 API 주소, default: "https://api.agit.in/v2" }
  - { key: agit_web, label: 아지트 주소, default: "https://kakao.agit.in", hint: "목록에서 공지 글로 바로 가는 링크를 만들 때 써요" }
  - { key: groups, label: 볼 그룹, default: "4", hint: "아지트 그룹 번호. 여럿이면 쉼표로 적어요. 4는 전사 공지 그룹이에요" }
  - { key: match, label: 공지 제목 규칙, default: "보안\\s*공지", hint: "글 첫 줄이 이 정규식에 맞는 것만 가져와요" }
  - { key: days, label: 며칠 전 글까지, default: "14" }
  - { key: projects, label: 점검할 프로젝트, type: lines, placeholder: "~/code/*", hint: "한 줄에 폴더 하나, 또는 폴더/*. 비우면 개발 도구 플러그인의 프로젝트 목록을 그대로 써요" }
  - { key: exclude, label: 뺄 프로젝트, type: lines, placeholder: "phocus", hint: "점검하지 않을 프로젝트 폴더 이름. 한 줄에 하나" }
  - { key: worktrees, label: 작업 폴더를 만들 곳, type: path, default: "~/.pkm-worktrees/security", hint: "공지마다 이 아래에 폴더를 하나 만들고, 고칠 레포의 git worktree를 그 안에 둬요. 내가 쓰는 저장소 폴더는 건드리지 않아요" }
  - { key: jira_url, label: Jira 주소, default: "https://kakao.atlassian.net" }
  - { key: jira_email, label: Jira 로그인 이메일, hint: "비우면 지라 자동 작업 플러그인에 적어 둔 이메일을 써요. Server·Data Center(PAT)면 둘 다 비워 두세요" }
  - { key: jira_project, label: 티켓을 만들 지라 프로젝트, default: "MCLP" }
  - { key: jira_type, label: 티켓 이슈 타입, default: "작업" }
  - { key: jira_summary, label: 티켓 제목, default: "[Web][{repo}] 보안이슈 대응", hint: "{repo}는 레포 폴더 이름으로 바뀌어요. 커밋 메시지와 PR 제목은 티켓 번호를 앞에 붙여요. 예) MCLP-123: [Web][레포] 보안이슈 대응" }
  - { key: pr_branch, label: 올릴 브랜치 이름, default: "feature/{key}", hint: "{key}는 만든 티켓 번호로 바뀌어요. 에이전트가 커밋해 둔 브랜치의 이름을 이것으로 바꿔 push해요" }
  - { key: pr_base, label: PR을 보낼 브랜치, default: "master", hint: "에이전트도 이 브랜치에서 갈라서 고쳐요. 원격에 이 브랜치가 없거나, 다른 브랜치에서 만든 수정을 옮기다 충돌이 나면 그 브랜치로 보내고 결과에 적어요" }
  - { key: github_api, label: GitHub API 주소, default: "https://github.daumkakao.com/api/v3", hint: "github.com이면 https://api.github.com. 레포의 origin이 이 GitHub이 아니면 올리지 않아요" }
  - { key: pr_assignee, label: PR 담당자, hint: "GitHub 아이디. 비우면 GitHub 토큰의 주인(나)이에요" }
---

사내 아지트에 보안 공지가 올라오면 가져와서, AI가 FE 프로젝트에 영향이 있는지 먼저 판단해요. 영향이 있으면 에이전트가 내 프로젝트를 하나씩 점검하고, 고칠 곳은 레포마다 작업 폴더(git worktree)에 로컬 브랜치를 만들어 수정·테스트·커밋해 둬요. 결과는 레포마다 무엇이 문제였고 어떻게 고쳤는지로 보여 줘요. 결과의 레포마다 [티켓 만들고 PR 올리기] 버튼이 있어요. 누르면 그 레포 하나에 지라 티켓을 만들고(공지 링크와 내용을 넣어요), 티켓 번호 브랜치로 push하고, PR을 올려 담당자를 나로 넣어요. 남은 레포를 한 번에 올리는 버튼도 있어요. 누르기 전에는 push도 PR도 하지 않아요.
