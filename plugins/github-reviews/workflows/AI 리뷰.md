## AI 리뷰
- [변경] 바뀐 코드 가져오기 · script: scripts/reviews.mjs diff --api={github_api} --repo={repo} --number={number}
- [판단] 큰 문제가 있는지 보기 · ai: prompts/리뷰.md
- [결정] 승인하거나 리뷰 남기기 · script: scripts/reviews.mjs decide --api={github_api} --repo={repo} --number={number} --head={변경.head} --verdict={판단.verdict} --summary={판단.summary} --findings={판단.findings} --lines={변경._lines} --truncated={변경.truncated}
