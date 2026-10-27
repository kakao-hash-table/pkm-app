---
pkm_plugin: 1
id: company-search
name: 사내 검색
version: 0.1.0
author: pkm
permissions:
  bundled: [scripts/search.mjs]
  secrets:
    - { name: ATLASSIAN_TOKEN, label: 위키·지라 토큰, hint: "위키(Confluence)와 지라에 같이 써요. Cloud는 API 토큰(이메일과 함께), Server·Data Center는 개인 액세스 토큰(PAT)이에요", url: "https://id.atlassian.com/manage-profile/security/api-tokens" }
    - { name: AGIT_TOKEN, label: 아지트 토큰, hint: "아지트 API 토큰이에요. 검색에만 써요" }
settings:
  - { key: wiki_url, label: 위키 주소, placeholder: "https://your-team.atlassian.net/wiki", hint: "Confluence 주소예요. 위키를 안 쓰면 비워 두세요" }
  - { key: jira_url, label: 지라 주소, placeholder: "https://your-team.atlassian.net", hint: "지라를 안 쓰면 비워 두세요" }
  - { key: atlassian_email, label: Atlassian 로그인 이메일, hint: "Atlassian Cloud(atlassian.net)만 적어요. Server·Data Center(PAT)면 비워 두세요" }
  - { key: agit_api, label: 아지트 API 주소, default: "https://api.agit.in/v2" }
  - { key: agit_web, label: 아지트 주소, placeholder: "https://your-team.agit.in", hint: "검색 결과에서 글로 바로 가는 링크를 만들 때 써요. 비우면 링크 없이 보여요" }
---

찾기 화면에서 회사 위키(Confluence), 지라, 아지트를 한 번에 찾아요. 각 서비스의 API로 읽기만 하고, 아무것도 쓰거나 바꾸지 않아요. 쓰는 서비스의 주소와 토큰만 넣으면 돼요.
