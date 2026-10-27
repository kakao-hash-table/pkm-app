---
pkm_plugin: 1
id: github-reviews
name: 코드 리뷰
version: 0.1.0
author: pkm
permissions:
  bundled: [scripts/reviews.mjs]
  secrets:
    - { name: GITHUB_TOKEN, label: GitHub 토큰, hint: "GitHub → Settings → Developer settings → Personal access tokens. classic이면 repo, fine-grained면 Pull requests·Contents·Metadata 읽기만 주면 돼요", url: "https://github.com/settings/tokens" }
settings:
  - { key: github_api, label: GitHub API 주소, hint: "github.com이면 그대로 두세요. 회사 GitHub(Enterprise)면 https://<주소>/api/v3", default: "https://api.github.com" }
  - { key: repos, label: 볼 저장소, type: lines, hint: "비우면 토큰으로 볼 수 있는 저장소 전체예요. 좁히려면 owner/name을 한 줄에 하나씩", placeholder: "owner/name" }
---

나한테 요청된 리뷰, 내가 요청한 리뷰, 나한테 달린 답변을 GitHub에서 가져와요. 읽기만 하고, GitHub에는 아무것도 쓰지 않아요.
