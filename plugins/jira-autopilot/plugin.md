---
pkm_plugin: 1
id: jira-autopilot
name: 지라 자동 작업
version: 0.1.0
author: pkm
permissions:
  ai: [agent]
  agent_mode: auto
  bundled: [scripts/jira.mjs, scripts/project.mjs, scripts/brief.mjs, scripts/branch.mjs, scripts/check.mjs]
  secrets:
    - { name: JIRA_TOKEN, label: Jira 토큰, hint: "Jira Cloud는 API 토큰(이메일과 함께), Server·Data Center는 개인 액세스 토큰(PAT)이에요", url: "https://id.atlassian.com/manage-profile/security/api-tokens" }
settings:
  - { key: jira_url, label: Jira 주소, placeholder: "https://your-team.atlassian.net" }
  - { key: jira_email, label: Jira 로그인 이메일, hint: "Jira Cloud만 적어요. Server·Data Center(PAT)면 비워 두세요" }
  - { key: jql, label: 가져올 티켓(JQL), default: "assignee = currentUser() AND statusCategory != Done AND created >= -14d ORDER BY created DESC" }
  - { key: start_status, label: 시작할 때 바꿀 지라 상태, default: "In Progress" }
  - { key: repos, label: 저장소가 모여 있는 폴더, type: path, placeholder: "~/code", hint: "이 폴더 바로 아래의 git 저장소 중에서 고르게 해요" }
  - { key: projects, label: 저장소 규칙, type: lines, placeholder: "ABC → web-app (기준 develop)", hint: "한 줄에 하나. 지라 프로젝트 키나 제목의 [태그] → 저장소 폴더 이름. 괄호에 기준 브랜치를 적을 수 있어요. 고르게 했던 답도 여기에 더해져요" }
  - { key: branch, label: 브랜치 이름, default: "feature/{key}", hint: "{key}는 티켓 키로 바뀌어요. 예: feature/{key}, bugfix/{key}" }
  - { key: base, label: 기준 브랜치, default: "main, master, develop", hint: "원격에 있는 것 중 앞에서부터 처음 찾은 것. 저장소 규칙의 (기준 …)이 먼저예요" }
  - { key: worktrees, label: 작업 폴더를 만들 곳, type: path, default: "~/.pkm-worktrees", hint: "티켓마다 여기에 작업 폴더(git worktree)를 따로 만들어서, 내가 쓰는 저장소 폴더는 건드리지 않아요" }
---

나한테 할당된 지라 티켓을 가져와서, 저장소와 설명을 먼저 확인하고 브랜치 규칙대로 작업 폴더를 만든 뒤, 지라를 진행 중으로 바꾸고 AI가 구현하고 커밋해요. 물어볼 게 있으면 지라를 바꾸기 전에 물어요. push와 PR은 하지 않아요. 결과를 보고 PR은 내가 올려요.
