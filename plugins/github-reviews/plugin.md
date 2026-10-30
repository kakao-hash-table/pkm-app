---
pkm_plugin: 1
id: github-reviews
name: 코드 리뷰
version: 0.2.1
author: pkm
permissions:
  ai: [chat]
  bundled: [scripts/reviews.mjs]
  secrets:
    - { name: GITHUB_TOKEN, label: GitHub 토큰, hint: "GitHub → Settings → Developer settings → Personal access tokens. 승인까지 하려면 classic은 repo, fine-grained는 Pull requests 쓰기·Contents·Metadata 읽기를 주세요", url: "https://github.com/settings/tokens" }
settings:
  - { key: github_api, label: GitHub API 주소, hint: "github.com이면 그대로 두세요. 회사 GitHub(Enterprise)면 https://<주소>/api/v3", default: "https://api.github.com" }
  - { key: repos, label: 볼 저장소, type: lines, hint: "비우면 토큰으로 볼 수 있는 저장소 전체예요. 좁히려면 owner/name을 한 줄에 하나씩", placeholder: "owner/name" }
  - { key: review_rules, label: 팀 리뷰 기준, type: lines, default: "", hint: "AI가 큰 문제를 판단할 때 함께 볼 팀 규칙(선택). 예: API 호출은 services/ 아래에서만", placeholder: "한 줄에 하나" }
---

나한테 요청된 리뷰, 내가 요청한 리뷰, 나한테 달린 답변을 GitHub에서 가져와요. 요청된 리뷰는 AI가 머지하면 안 되는 큰 문제가 있는지만 보고, 없으면 여기서 바로 승인하고, 있으면 코드 위치와 남길 리뷰를 보여 줘요. GitHub에 쓰는 것은 내가 누른 승인 하나뿐이에요.
