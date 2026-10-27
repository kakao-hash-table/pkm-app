# pkm 플러그인 규격 (pkm_plugin: 1)

플러그인은 특정 일(배포, 블로그 발행, 공부 같은 도메인)에 맞춘 워크플로우를 pkm에 더하는 꾸러미입니다. pkm 코어에는 도메인 개념을 넣지 않고, 도메인에 맞춘 것은 플러그인에 둡니다.

플러그인은 **선언형**입니다. 무엇을 할지 마크다운으로 적고, 실제 실행은 사용자 컴퓨터의 pkm-ai-server가 맡습니다. 화면에서 실행되는 코드(JS, HTML)는 받지 않습니다.

## 꾸러미

git 저장소나 폴더 하나가 플러그인 하나입니다.

```
plugin.md          필수. 매니페스트(프런트매터)와 설명
workflows/*.md     워크플로우
feeds/*.md         선택. 주기적으로 가져올 목록(피드)
prompts/*.md       AI 프롬프트
scripts/*          선택. 플러그인이 가져오는 스크립트(.mjs .cjs .js .sh .py)
templates/*.md     선택. 카드나 기록 템플릿
```

받는 파일은 문서(`.md` `.json` `.yml` `.yaml` `.txt`), 이미지(`.png` `.jpg` `.gif` `.webp`), 그리고 `permissions.bundled`에 적은 스크립트뿐입니다. 이름이 `.`으로 시작하는 파일과 폴더(`.git` 등), `node_modules`는 보지 않습니다. 파일은 200개, 하나에 1MB, 전체 5MB까지입니다. 링크 파일은 받지 않습니다.

## plugin.md

```markdown
---
pkm_plugin: 1
id: deploy-loop
name: 배포 루프
version: 0.1.0
author: example
homepage: https://github.com/example/pkm-plugin-deploy
collects: { tag: deploy }
permissions:
  ai: [chat, agent]
  agent_mode: read
  scripts: [jira]
  bundled: [scripts/pr-body.mjs]
settings:
  - { key: jira_project, label: 지라 프로젝트 키 }
---

지라 착수부터 PR, 리뷰까지 한 카드에서 진행해요.
```

| 키 | 필수 | 뜻 |
|---|---|---|
| `pkm_plugin` | 예 | 규격 버전. 지금은 `1` |
| `id` | 예 | 소문자, 숫자, `-`로 2~41자. 설치 폴더 이름이 됩니다 |
| `name` | 예 | 화면에 보일 이름 |
| `version` | 예 | `1.2.3` 형식 |
| `author`, `homepage`, `description` | | 설명. 본문 첫 문단도 설명으로 씁니다 |
| `requires` | | 필요한 버전. 예: `{ pkm: ">=0.2", ai_server: ">=0.2" }` |
| `collects` | | 워크스페이스에 모을 단기. `{ tag: deploy }` 또는 `{ area: "[[배포]]" }` |
| `permissions.ai` | | 쓸 AI. `chat`(도구 없는 AI), `agent`(파일 읽기·쓰기·명령 실행) |
| `permissions.agent_mode` | | 에이전트 모드 상한. `read` < `auto` < `full`. 기본 `read` |
| `permissions.scripts` | | 사용자가 자기 컴퓨터에 등록해 둬야 하는 스크립트 이름(`pkm-ai-server script add`) |
| `permissions.bundled` | | 플러그인이 가져오는 스크립트. `scripts/` 아래에 있어야 합니다 |
| `permissions.secrets` | | 스크립트가 환경 변수로 받을 비밀값 이름(영문 대문자·숫자·`_`). 문자열이나 `{ name, label, hint, url }`. 값은 실행하는 컴퓨터의 pkm-ai-server에만 둡니다 |
| `settings` | | 설치한 뒤 사용자가 채울 값. `{ key, label, hint, type, default, placeholder }`. `type`은 `text`(기본)·`lines`(여러 줄)·`path`·`toggle`. 값은 그 플러그인을 돌리는 컴퓨터에만 저장합니다 |

## 워크플로우

`workflows/*.md`에서 `## 이름`이 워크플로우 하나, 그 아래 목록이 단계입니다.

```markdown
## 배포
- [착수] 지라 진행으로 · script: jira transition {key} 진행
- [PR] PR 설명 초안 · ai: prompts/pr.md
- [본문] PR 본문 만들기 · script: scripts/pr-body.mjs {key}
- [리뷰] 변경 검토 · agent(read): 이 카드의 경로에서 바뀐 파일을 읽고
  위험한 부분만 짧게 알려 줘
- [확인] 직접 확인 · manual
```

- 형식은 `- [키] 단계 이름 · 종류 [in 폴더]: 내용`입니다. `in {브랜치.path}`처럼 쓰면 그 폴더에서 실행합니다(에이전트의 작업 폴더).
- 두 칸 들여 쓴 줄은 앞 단계 내용에 이어 붙습니다.
- 중괄호는 값으로 바뀝니다: `{title}` `{url}` `{id}`(항목), 항목의 `vars`(예: `{key}`), 설정 키(예: `{jira_url}`), 앞 단계 결과(`{저장소.dir}` — 단계 키.결과 필드). 바꾼 값은 인자 하나로 넘어가고(띄어쓰기가 있어도), 바꾼 값 안의 중괄호는 다시 바꾸지 않습니다. 채우지 못한 자리가 있으면 그 단계는 실행하지 않고 멈춥니다.

스크립트 단계의 결과(stdout 마지막 줄 JSON):

| 필드 | 뜻 |
|---|---|
| `summary` | 단계 목록에 보일 한 줄 |
| `error` | 실패 이유(사람에게 보일 말). 종료 코드가 0이 아니어도 이 말을 씁니다 |
| `ask` | `{ question, hint, choices:[{value, label, hint}] \| [문자열], free, placeholder }` — 사람에게 묻고 멈춥니다. 답하면 같은 단계를 `--answer=<답>`을 붙여 다시 실행합니다 |
| `settings_patch` | `{ 설정키: 새 값 }` — 이 컴퓨터의 플러그인 설정을 바꿉니다(예: 고른 답을 규칙에 기억). 선언한 키만 |
| 그 밖 | 다음 단계에서 `{단계키.필드}`로 씁니다 |

`manual` 단계는 사람이 [끝난 것으로 옮기기]를 누를 때까지 기다립니다. 에이전트 단계를 다시 시키면 같은 세션을 이어서, 사람이 적은 요청을 덧붙여 돌립니다.

## 피드

`feeds/*.md`에서 `## 이름`이 목록 하나, 그 아래 `- 키: 값` 줄이 설정입니다. 다른 줄은 설명입니다.

```markdown
## 나한테 할당된 티켓
아직 끝나지 않은 내 티켓이에요.
- run: scripts/jira.mjs assigned --url={jira_url} --jql={jql}
- every: 15
- days: weekdays
- hours: 08:00-20:00
- start: 지라 자동 작업
- start_mode: auto
- empty: 지금 나한테 할당된 티켓이 없어요
```

| 키 | 뜻 |
|---|---|
| `run` | 실행할 스크립트(`permissions.bundled`)와 인자. 설정 키를 `{}`로 씁니다 |
| `every` | 몇 분마다(5~1440, 기본 60) |
| `days`, `hours` | `weekdays`·`daily`, `09:00-18:00`. 이 밖에서는 자동으로 가져오지 않습니다(직접 가져오기는 됩니다) |
| `start`, `start_mode` | 항목마다 돌릴 워크플로우와 시작 방식. `button`(기본)은 [시작하기]로, `auto`는 사용자가 자동 시작을 켠 뒤에 **새로 들어온** 항목만 저절로 시작합니다. 처음 가져온 목록은 원래 있던 것으로 봅니다 |
| `count` | `no`면 '지금'과 탭의 '볼 것' 개수에 세지 않습니다 |
| `empty` | 비었을 때 보일 말 |

스크립트는 `{ items: [...] , note? }` JSON을 냅니다. 항목은 `{ id, title, url, meta:[짧은 글], tags:[배지 글], at, version, detail:[{ who, at, kind, text, url }], vars:{ 워크플로우에 넘길 값 } }`이고, 화면은 이스케이프한 글자만 그립니다. `url`은 http(s)만 링크가 됩니다.

## 실행기 — 누가 언제 돌리나

- 피드와 워크플로우는 **돌리는 컴퓨터** 하나의 pkm 서버가 돌립니다(`server/runner.js`). 브라우저를 닫아도 돕니다. 프로필마다 하나이고 `<프로필>/_플러그인/.state/runner.json`에 적혀 동기화됩니다. 다른 컴퓨터에서 [이 컴퓨터로 옮기기]를 하면 앞 컴퓨터는 받는 대로 멈춥니다.
- 돌리는 컴퓨터만 갖는 것(동기화하지 않음): `~/.pkm-app/runner.json`(그 컴퓨터의 AI 연결, 플러그인 설정값, 자동 시작). 비밀값은 pkm-ai-server에만 있습니다.
- 가져온 목록과 실행 기록은 `<프로필>/_플러그인/.state/<id>.json`(돌리는 컴퓨터만 씁니다). 다른 기기에서 누른 것(답하기·다시 하기·그만두기)은 `<id>.inbox.<컴퓨터>.json`으로 남아 동기화되고, 돌리는 컴퓨터가 한 번씩만 처리합니다.
- 한 플러그인 안에서 실행은 하나씩 차례로 합니다. 한도·로그인으로 pkm-ai-server가 기다리면 그 단계도 '기다림'으로 둡니다.

| 종류 | 내용 | 실행 |
|---|---|---|
| `manual` | 없음 | 사람이 하고 체크 |
| `script` | 첫 단어가 `permissions.scripts`의 이름이거나 `permissions.bundled`의 경로. 나머지는 인자 | pkm-ai-server가 셸 없이 실행. 인자는 글자 그대로 넘어갑니다 |
| `ai` | `prompts/…md` 경로나 프롬프트 글 | 도구 없는 AI 한 번 |
| `agent(모드)` | 위와 같음 | 에이전트. 모드는 `agent_mode` 상한을 넘을 수 없습니다 |

선언하지 않은 스크립트를 부르거나, 선언하지 않은 AI를 쓰거나, 상한보다 높은 모드를 쓰는 단계가 있으면 플러그인 전체를 받지 않습니다.

## 받는 규칙

1. **검사:** 설치 전에 위 규격을 검사합니다. 하나라도 어기면 설치하지 않습니다. 검사 코드는 `web/js/pkm-plugin.js`이고, 화면과 서버가 같은 코드를 씁니다.
2. **받는 곳:** git 주소(`https://`)와 로컬 폴더 두 가지입니다. 로컬 폴더는 pkm을 로컬 서버로 열었을 때만 됩니다. git은 받은 커밋 해시를 기록하고, 자동으로 업데이트하지 않습니다.
3. **설치 위치:** `<프로필>/_플러그인/<id>/`입니다. Obsidian에서도 보이고, 프로필과 함께 동기화됩니다. 같은 id를 다시 설치하면 이전 것은 `.trash/_플러그인/`으로 옮깁니다.
4. **스크립트 승인은 실행하는 컴퓨터에서:** 설치할 때 가져오는 스크립트의 내용을 보여 주고 동의를 받습니다. 동의는 그 컴퓨터의 pkm-ai-server에 파일 해시로 남깁니다. 이후 내용이 한 글자라도 바뀌면, 다시 승인하기 전까지 실행하지 않습니다.
5. **권한 검사는 두 번:** pkm 화면이 한 번, pkm-ai-server가 한 번 더 합니다. 플러그인 요청에는 플러그인 id가 붙고, pkm-ai-server는 승인할 때 기록한 권한 밖의 요청을 거절합니다.
6. **비밀은 넣지 않습니다:** 토큰 같은 비밀은 플러그인에도 `settings`에도 넣지 않습니다. 프로필 데이터는 GitHub로 동기화될 수 있기 때문입니다. `permissions.secrets`에 이름만 선언하면, 사용자가 화면에서 넣은 값이 그 컴퓨터의 pkm-ai-server(`~/.pkm-ai-server/secrets.json`, 0600)에만 저장되고, 승인한 플러그인 스크립트를 실행할 때만 환경 변수로 들어갑니다. 값은 다시 보여 주지 않고, 스크립트가 값을 찍어도 기록에는 `***`로 남습니다. 에이전트·AI 단계에는 넘기지 않습니다.
7. **플러그인 글은 믿지 않는 입력입니다:** 프롬프트는 선언한 권한 안에서만 실행됩니다. 남이 만든 플러그인은 `agent_mode: read`보다 높은 권한을 요구하는지 꼭 확인하세요.

## 서버 API

pkm 로컬 서버:

| 요청 | 하는 일 |
|---|---|
| `POST /api/plugins/inspect {git, ref}` 또는 `{local}` | 받아서 검사만 합니다. 결과로 `stage`, 검사 결과, 매니페스트, 가져오는 스크립트 내용과 해시를 돌려줍니다 |
| `POST /api/profile/:p/plugins {stage}` | 검사한 플러그인을 그 프로필에 설치 |
| `GET /api/profile/:p/plugins` | 설치된 플러그인. 설치 뒤 바뀐 파일이 있으면 `changed`에 나옵니다 |
| `DELETE /api/profile/:p/plugins/:id` | 휴지통으로 |
| `GET /api/plugins/bundled` | 앱에 들어 있는 플러그인(`plugins/*`) |
| `GET /api/profile/:p/plugins/state` | 피드·실행 기록, 이 컴퓨터와 돌리는 컴퓨터 |
| `POST /api/profile/:p/runner {on, ai:{url, token}}` | 이 컴퓨터에서 돌리기 켜기·끄기, 이 컴퓨터의 AI 연결 |
| `GET /api/profile/:p/plugins/:id/machine` | 이 컴퓨터의 승인·비밀값 상태(값은 없음) |
| `POST /api/profile/:p/plugins/:id/approve` | 이 컴퓨터의 pkm-ai-server에 승인 |
| `POST /api/profile/:p/plugins/:id/secret {name, value\|null}` | 비밀값 넣기·지우기 |
| `POST /api/profile/:p/plugins/:id/local {settings, auto}` | 이 컴퓨터의 설정값, 자동 시작 |
| `POST /api/profile/:p/plugins/:id/act {type, …}` | `refresh`·`start`·`answer`·`confirm`·`retry`·`skip`·`cancel`·`dismiss`. 돌리는 컴퓨터가 아니면 받은편지함으로 보냅니다 |
| `GET /api/profile/:p/plugins/:id/scripts` | 가져오는 스크립트 내용(승인 전에 보여 줌) |

pkm-ai-server:

| 요청 | 하는 일 |
|---|---|
| `POST /v1/plugins {id, root, version, permissions, files}` | 승인. `files`는 화면에서 보여 준 스크립트의 해시이고, 지금 파일과 같아야 승인됩니다 |
| `GET /v1/plugins` | 이 컴퓨터에서 승인한 플러그인 |
| `DELETE /v1/plugins?id=&root=` | 승인 거두기 |
| `GET /v1/secrets` · `POST /v1/secrets {name, value}` · `DELETE /v1/secrets?name=` | 비밀값 이름과 넣은 때만 돌려줍니다(값은 돌려주지 않음) |
| `POST /v1/jobs {plugin:{id, root}, plugin_script, args}` | 플러그인 스크립트 실행 |
| `POST /v1/jobs {plugin:{id, root}, …}` | 플러그인 이름으로 AI·에이전트·등록 스크립트 실행. 선언한 권한 안에서만 됩니다 |

## 예시

`test/fixtures/plugin-ok/`가 규격을 모두 지킨 예시입니다. 실제로 쓰는 예시는 `plugins/`에 있습니다.

- `plugins/github-reviews` — 코드 리뷰: 나한테 요청된 리뷰, 나한테 달린 답변, 내가 요청한 리뷰. GitHub·GitHub Enterprise, 읽기만.
- `plugins/jira-autopilot` — 지라 자동 작업: 내게 할당된 티켓 → 저장소 찾기(규칙·브랜치 이력·물어보기) → 설명 확인 → 브랜치 규칙대로 작업 폴더(git worktree) → 지라 진행 중 → AI 구현·커밋 → 점검 → 사람 확인. push·PR은 하지 않습니다.
