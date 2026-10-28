# pkm 플러그인 규격 (pkm_plugin: 1)

플러그인은 특정 일(배포, 블로그 발행, 공부 같은 도메인)에 맞춘 워크플로우를 pkm에 더하는 꾸러미입니다. pkm 코어에는 도메인 개념을 넣지 않고, 도메인에 맞춘 것은 플러그인에 둡니다.

플러그인은 **선언형**입니다. 무엇을 할지 마크다운으로 적고, 실제 실행은 사용자 컴퓨터의 pkm-ai-server가 맡습니다. 화면에서 실행되는 코드(JS, HTML)는 받지 않습니다.

## 꾸러미

git 저장소나 폴더 하나가 플러그인 하나입니다.

```
plugin.md          필수. 매니페스트(프런트매터)와 설명
workflows/*.md     워크플로우
feeds/*.md         선택. 주기적으로 가져올 목록(피드)
searches/*.md      선택. 찾기 화면에 결과를 더하는 검색(사내 위키 같은)
editors/*.md       선택. 노트를 칸별로 나눠 글자 수를 세며 고치는 편집기
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
| `ask` | `{ question, hint, choices:[{value, label, hint, recommended, confirm}] \| [문자열], free, placeholder, inline }` — 사람에게 묻고 멈춥니다. 답하면 같은 단계를 `--answer=<답>`을 붙여 다시 실행합니다. `inline: true`면 선택지를 목록 줄과 작업 화면에 버튼으로 바로 보이고, `confirm`이 있는 선택지는 누를 때 그 말로 한 번 더 묻습니다 |
| `verdict` | `{ tone: ok\|bad, title, text }` — 이 단계의 판정. 화면은 항목 자리와 작업 화면 맨 위에 이 상자를 그립니다. 답을 받아 다시 실행해도 같은 판정을 내면 줄 높이가 바뀌지 않습니다 |
| `findings` | `[{ where, url, tag, title, text, copy, note }]` — 짚은 곳. `where`는 위치 글자(예: `src/a.tsx:12-18`), `url`은 그 위치로 가는 http(s) 주소, `copy`는 [문구 복사]로 복사할 글. 판정 상자 안에 차례로 그립니다 |
| `outcome` | `{ title, text }` — 사람이 고른 뒤 한 일(예: 승인함). 끝난 실행은 버튼 자리에 `✓ title · 시각`을 둡니다 |
| `settings_patch` | `{ 설정키: 새 값 }` — 이 컴퓨터의 플러그인 설정을 바꿉니다(예: 고른 답을 규칙에 기억). 선언한 키만 |
| `_이름` | 다음 단계에만 넘길 큰 값(예: `_diff`). 실행이 끝나거나 그만두면 상태 파일에서 지웁니다(상태 파일은 동기화됩니다) |
| 그 밖 | 다음 단계에서 `{단계키.필드}`로 씁니다 |

`ai` 단계의 프롬프트가 `prompts/이름.md`이고 옆에 `prompts/이름.schema.json`(JSON 스키마)이 있으면, 그 모양의 JSON으로 답하게 합니다. 지원하는 AI(claude)는 구조화된 결과로 받고, 나머지는 프롬프트 끝에 스키마를 붙여 글 끝의 JSON을 읽습니다. 결과 필드는 `{판단.verdict}`처럼 다음 단계에서 씁니다.

`manual` 단계는 사람이 [끝난 것으로 옮기기]를 누를 때까지 기다립니다.

**내 확인(HIL) 단계:** 자동으로 시작한(`start_mode: auto`) 작업에서, 사용자가 [준비와 설정 › 자동 시작]에서 체크한 단계는 하기 전에 내 차례로 멈춥니다(`ask.type: gate`). [이 단계 하기]를 누르면 그 단계부터 이어서 하고, [건너뛰고 이어 하기]도 됩니다. [시작하기]로 직접 시작한 작업은 멈추지 않습니다. 체크는 돌리는 컴퓨터의 `~/.pkm-app/runner.json`(`gates`)에 둡니다. 에이전트 단계를 다시 시키면 같은 세션을 이어서, 사람이 적은 요청을 덧붙여 돌립니다.

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
| `every` | 몇 분마다(5~1440, 기본 60). 사용자가 [준비와 설정 › 가져오는 주기]에서 목록마다, 또는 한 번에 모두 바꿀 수 있고 그 값은 돌리는 컴퓨터에만 둡니다 |
| `days`, `hours` | `weekdays`·`daily`, `09:00-18:00`. 이 밖에서는 자동으로 가져오지 않습니다(직접 가져오기는 됩니다) |
| `start`, `start_mode` | 항목마다 돌릴 워크플로우와 시작 방식. `button`(기본)은 [시작하기]로, `auto`는 사용자가 자동 시작을 켠 뒤에 **새로 들어온** 항목만 저절로 시작합니다. 처음 가져온 목록은 원래 있던 것으로 봅니다 |
| `view` | `sections`(기본)는 내 차례·진행 중·시작 전 섹션으로 나눠 보입니다. `inline`은 항목을 가져온 순서 그대로 두고 **그 자리에서** 진행 상태·판정·선택지를 보입니다. 목록에서 빠진 항목도 사용자가 그 칸을 떠나기 전까지는 같은 자리에 둡니다(레이아웃이 밀리지 않게). `start`가 있어야 합니다 |
| `start_label` | 시작 버튼 글자(기본 '시작하기') |
| `dismiss` | `yes`면 줄마다 [×](확인하고 닫기)가 생깁니다. 항목 `version`째 기억해서, 버전이 바뀌면(새 답 등) 다시 보입니다. 목록에서 빠진 항목은 닫은 기록도 지웁니다. `start`가 없는 목록에만 씁니다 |
| `count` | `no`면 '지금'과 탭의 '볼 것' 개수에 세지 않습니다 |
| `empty` | 비었을 때 보일 말 |

스크립트는 `{ items: [...] , note? }` JSON을 냅니다. 항목은 `{ id, title, url, meta:[짧은 글], tags:[배지 글], at, version(바뀌면 다시 시작할 수 있는 값, 예: 커밋), detail:[{ who, at, kind, text, url }], vars:{ 워크플로우에 넘길 값 } }`이고, 화면은 이스케이프한 글자만 그립니다. `url`은 http(s)만 링크가 됩니다.

피드 하나에서 여러 워크플로우를 고를 수 있습니다. `start: 실행, 멈추기, 고치기`처럼 쉼표로 적으면 항목마다 버튼이 생기고, 첫 번째가 주 버튼입니다. `start_mode: auto`는 첫 번째 워크플로우에만 적용됩니다. 같은 항목에서 같은 워크플로우는 하나씩만 돌고, 다른 워크플로우는 따로 돌 수 있습니다.

## 검색

`searches/*.md`에서 `## 이름`이 검색 하나입니다. 찾기 화면에서 낱말을 넣고 [이름에서 찾기]를 누르면 돌립니다(글자를 칠 때마다 돌리지 않습니다).

```markdown
## 위키
회사 위키 페이지 제목과 본문에서 찾아요.
- run: scripts/search.mjs wiki --url={wiki_url} --q={q}
- limit: 8
```

| 키 | 뜻 |
|---|---|
| `run` | 실행할 스크립트(`permissions.bundled`)와 인자. `{q}`가 찾는 말로 바뀝니다. 설정 키도 씁니다 |
| `limit` | 보일 결과 수(1~30, 기본 8) |

스크립트는 피드와 같은 `{ items: [...], note? }`를 냅니다. 찾기는 사람이 기다리는 일이라 60초 안에 끝나야 합니다. 검색은 이 컴퓨터의 pkm-ai-server가 돌리므로, 이 컴퓨터에서 플러그인을 승인하고 AI 연결이 있어야 합니다(돌리는 컴퓨터가 아니어도 됩니다).

## 편집기

`editors/*.md`에서 `## 이름`이 편집기 하나입니다. 노트 하나를 제목 줄 단위로 나눠 칸마다 글자 수를 세며 고치게 합니다. 성과 평가처럼 칸마다 글자 수 제한이 있는 글에 씁니다. 실행되는 것은 없고 앱이 화면을 그립니다.

```markdown
## 주요 업무
- note: {main_note}
- block: ##
- title: 300
- body: 300
- body_end: ^\(\d+자\)
- count: ^\((\d+)자\)
```

| 키 | 뜻 |
|---|---|
| `note` | 고칠 노트의 제목(맥락노트·영구노트). 설정 키를 쓸 수 있습니다 |
| `block` | 칸 하나가 되는 제목 줄 수준(`##`~`######`) |
| `within` | 이 정규식에 맞는 줄 아래에서만 칸을 찾습니다(그 줄과 같거나 높은 수준의 다음 제목까지) |
| `group` | 칸을 묶어 보일 위 수준 제목(예: `###`) |
| `title`, `body` | 제목과 본문의 글자 수 제한. 공백·줄바꿈을 포함해 셉니다. 비우면 제한 없이 셉니다 |
| `body_start` | 본문이 이 정규식에 맞는 줄 다음부터 시작합니다. 적으면 그 줄이 있는 칸만 고칠 칸이 됩니다. 없으면 제목 바로 아래부터 |
| `body_end` | 본문이 이 정규식에 맞는 줄 앞에서 끝납니다. 적으면 그 줄이 있는 칸만 고칠 칸이 됩니다. 없으면 다음 제목 앞까지 |
| `fields` | 제목과 본문 사이의 `- 이름: 값` 줄 중 따로 고칠 것. 쉼표로 적습니다(예: `진행기간, 진행상태`) |
| `count` | 저장할 때 이 정규식에 맞는 본문 뒤 첫 줄의 첫 괄호 숫자를 새 본문 글자 수로 바꿉니다 |

편집기는 고친 칸만 원래 글에 다시 끼워 넣고, 나머지 글은 그대로 둡니다. 저장하면 다른 편집처럼 되돌릴 수 있습니다.

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
   **업데이트:** 설치 기록(`.pkm-install.json`)의 출처를 다시 읽어 설치한 파일 해시와 견줍니다. 앱에 들어 있는 플러그인(`plugins/<id>`)은 경로가 아니라 '앱 내장 + id'로 기록해서, 앱을 업데이트하면 어느 컴퓨터에서든 새 버전이 보입니다. 앱 내장과 로컬 폴더는 목록을 볼 때마다 견주고, git은 [git에서 새 버전 확인]을 누를 때 받아 봅니다. 업데이트는 같은 검토 화면(바뀌는 파일·스크립트 내용)을 거쳐 같은 id로 다시 설치하는 것이라, 이 컴퓨터의 설정값·비밀값과 가져온 목록·실행 기록은 그대로 남고 스크립트가 바뀌었으면 다시 승인합니다.
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
| `GET /api/profile/:p/plugins` | 설치된 플러그인. 설치 뒤 바뀐 파일이 있으면 `changed`에 나옵니다. `updates`에는 출처에 새 버전이 있는 것(`{ kind, from, to, files }`, git은 `{ kind: 'git', check: true }`) |
| `POST /api/profile/:p/plugins/:id/update` | 설치 기록의 출처에서 다시 가져와 검사만 합니다. 결과는 `inspect`와 같고 `update: { from, to, changes }`가 붙습니다. 설치는 `POST …/plugins {stage}` |
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

- `plugins/github-reviews` — 코드 리뷰: 나한테 요청된 리뷰, 나한테 달린 답변, 내가 요청한 리뷰. GitHub·GitHub Enterprise. 요청된 리뷰는 AI가 머지하면 안 되는 큰 문제(보안·로직·훅·누수·에러 처리·타입·접근성·성능·실수로 넣은 코드)만 보고, 없으면 [승인하기](검토한 커밋에만, 그 사이 새 커밋이 오면 거절), 있으면 파일:줄과 남길 리뷰 문구를 보입니다. GitHub에 쓰는 것은 사람이 누른 승인 하나입니다.
- `plugins/jira-autopilot` — 지라 자동 작업: 내게 할당된 티켓 → 저장소 찾기(규칙·브랜치 이력·물어보기) → 설명 확인 → 브랜치 규칙대로 작업 폴더(git worktree) → 지라 진행 중 → AI 구현·커밋 → 점검 → 사람 확인. push·PR은 하지 않습니다.
- `plugins/company-search` — 사내 검색: 찾기 화면에 위키(Confluence)·지라·아지트 검색을 더한다. 읽기만. `searches/` 예시.
- `plugins/perf-review` — 성과 평가 글: 글자 수 제한이 있는 노트를 칸마다 세며 고친다. 스크립트 없음. `editors/` 예시.
- `plugins/dev-tools` — 개발 도구: 프로젝트 개발 서버 실행·멈추기, AI로 고치기, 사용성 점검, 에이전트 파일 고치기. 한 목록에 워크플로우 여럿(`start: 실행, 멈추기, …`) 예시.
