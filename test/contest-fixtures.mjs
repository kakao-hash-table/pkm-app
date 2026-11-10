// 공모전 테스트 자료 — 주최가 공개한 양식·폼·공고의 사본이라 이 저장소에 두지 않는다.
// 데이터 폴더에서 읽는다: PKM_TEST_FIXTURES/contest-apply, 없으면 이 저장소 옆의 pkm-hash/data/_테스트자료/contest-apply. 자료가 없으면 그 테스트는 건너뛴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.PKM_TEST_FIXTURES || fileURLToPath(new URL('../../pkm-hash/data/_테스트자료/', import.meta.url));
export const FX_DIR = path.join(root, 'contest-apply') + path.sep;
export const HAS_FX = fs.existsSync(FX_DIR);
export const NO_FX = '공모전 테스트 자료가 없어 건너뛰어요(데이터 폴더의 _테스트자료/contest-apply — test/contest-fixtures.mjs)';
