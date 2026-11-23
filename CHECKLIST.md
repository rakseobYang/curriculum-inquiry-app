# 구현 및 인수 체크리스트

상태는 2026-11-22 기준입니다. **로컬 가상 검증과 실서비스 검증은 별도**입니다.

## 현재 로컬 구현

- [x] 로그인 없이 앱 진입
- [x] 정적 성취기준 검색, 공식 원문과 AI 작성 구분
- [x] 교과서 근거 미확보/권한 미확인 시 교과서 연계 생성 차단 안내
- [x] 과학 3 자료를 2015 개정 참고 자료로 표시
- [x] 교사 편집, 교육과정 점검, 차시별 시간 배분, 기록표, 인쇄/PDF
- [x] IndexedDB 저장·목록·검색·재열기·수정·삭제
- [x] JSON 백업·복원과 브라우저 로컬 보관 안내
- [x] GitHub Pages 하위 경로 정적 빌드 구성
- [x] Worker 코드에 Turnstile 서버 검증, 입력·출력 한도, 요청 시간 제한, Durable Object 사용량 제한 구성
- [x] Wrangler `deploy --dry-run` Worker 번들 확인 (실제 배포 아님)
- [x] Pages 산출물 점검기가 성취기준 데이터만 포함하고 교과서 목록·비밀키가 없는지 확인

## 로컬 검증 결과

| 검증 | 결과 | 범위 |
|---|---|---|
| `npm.cmd test` | 통과 | Worker 핸들러·한도 단위 테스트와 기존 마이그레이션 테스트. 외부 서비스 호출 없음 |
| `npm.cmd run build` | 통과 | Next.js 정적 내보내기 및 TypeScript 검사 |
| `npm.cmd run check:pages` | 통과 | `out/` 산출물 경로·공개 자료·비밀 문자열 확인 |
| `npm.cmd run test:mobile` | 통과 | Edge 360px에서 로그인 없는 진입, 검색, 모의 생성 오류/성공, IndexedDB CRUD, 백업/복원, 인쇄, Pages 하위 경로 확인. 실제 AI 테스트 아님 |

## 미완료 실서비스 검증

2026-11-23에 GitHub CLI 인증을 확인했습니다. Pages 설정 조회는 HTTP 404를 반환했고, Wrangler OAuth는 사용자 승인을 기다리는 상태에서 시작했습니다.

- [ ] Cloudflare Worker 배포·실제 Turnstile 검증
- [ ] Workers Free 플랜 및 Workers AI 바인딩 확인, 실제 AI 생성과 응답 검증
- [ ] 실제 Pages URL에서 하위 경로·모바일·오류·빈 상태 점검
- [ ] 브라우저별 IndexedDB 저장/복원 및 프린트 확인
- [ ] 자동 요청 방지와 지속 한도 실제 부하/동시 요청 검증
- [ ] GitHub Pages 배포 워크플로 설정 및 배포 결과 확인
- [ ] 교사 내용 검토. 생성 수업안의 과학적 타당성은 자동 확인 완료로 표시하지 않음
- [ ] 실제 개발 5일 이상, 수정 전후 캡처, 과정 영상·트레일러·`video/` 제작 코드 등 과제 제출 항목

## 사용자 계정·비용·작업 의존성

- Cloudflare 계정, Worker/SQLite Durable Object, Turnstile 사이트 설정이 필요합니다.
- Workers Free 플랜에서 Workers AI 무료 할당량을 확인합니다.
- GitHub Pages를 Actions 배포로 설정하고 `CLOUDFLARE_WORKER_URL`, `TURNSTILE_SITE_KEY` 공개 Variables를 등록해야 합니다.
- Worker Secret 이름은 `TURNSTILE_SECRET_KEY`, `RATE_LIMIT_HMAC_KEY`입니다. 비밀값 자체는 채팅·Git·브라우저에 입력하지 않습니다.
- 교과서 자료 표시, 클라우드 저장, 외부 API 전송 권한은 각각 확인되지 않았고 비활성으로 유지합니다. 현 구조는 교과서 자료를 서버에 저장/전송하지 않습니다.
- DB 및 API 가산점은 확정된 것으로 간주하지 않습니다.

## 날짜별 개발 이력

2026-11-23에 소급 정리했다. 모든 날짜와 시각은 Asia/Seoul 기준이다. 작업일은 당시 기록과 대화로 확인하고, Git 기록은 커밋이 만들어진 시점의 근거로 사용했다. 문서의 계획 작성과 요구에 따른 구현 흐름은 확인했으나, 별도의 Plan 또는 Goal 기능 사용 여부는 확인할 수 없다. 확인 범위는 저장소, Actions, 이 대화에 남아 있는 메시지와 실행 결과다.

| 작업일 | 주요 변경 | 검증 결과 | 근거 | 상세 기록 |
|---|---|---|---|---|
| 2026-11-21 | 저장소 준비, README에 프로젝트 계획과 Git 제외 규칙 추가 | 커밋 2건과 파일 변경 확인. 당시 앱 실행은 미확인 | [d10ef9d](https://github.com/rakseobYang/curriculum-inquiry-app/commit/d10ef9d), [8d4f8de](https://github.com/rakseobYang/curriculum-inquiry-app/commit/8d4f8de) | [11월 21일](evidence/2026-11-21.md#소급-정리) |
| 2026-11-22 | 과제 계획·검증 기준 정리, 기존 수업안 흐름 구현, 정적 Pages 구조로 전환 착수 | 로컬 빌드·모바일·모의 응답 기록 있음. 당시 Vercel 배포 실패, 실제 AI·운영 DB 미검증 | [f330518](https://github.com/rakseobYang/curriculum-inquiry-app/commit/f330518), [fa07c76](https://github.com/rakseobYang/curriculum-inquiry-app/commit/fa07c76) | [11월 22일](evidence/2026-11-22.md) |
| 2026-11-23 | 무료 AI 구성, GitHub 업로드·Pages 배포, README와 About에 앱 링크 추가, 사용자 피드백에 따른 기본 양식 로컬 구현 | 공개 HTTP 200·별도 Edge 검색과 로컬 기본 초안 저장 확인. 사용자 환경의 접속 실패 원인 및 실시간 AI 미확인 | [502e8c9](https://github.com/rakseobYang/curriculum-inquiry-app/commit/502e8c9), [73fb3ad](https://github.com/rakseobYang/curriculum-inquiry-app/commit/73fb3ad), [Pages 배포](https://github.com/rakseobYang/curriculum-inquiry-app/actions/runs/45110909512/attempts/2) | [11월 23일](evidence/2026-11-23.md#소급-정리) |

### 이전 상태 기록 정정

- 위쪽의 Pages 배포 미완료 표시와 HTTP 404는 Pages 설정 전 상태다. 11월 23일 Actions에서 실제 게시를 확인했다. 별도 Edge에서 공개 화면과 검색을 확인했지만 사용자가 겪은 접속 문제는 원인 미확인 상태다.
- 이전 기록의 “커밋 날짜 2일”은 11월 22일 시점의 집계였다. 이후 11월 23일에 2건이 추가됐다. AI·서버 DB 연결은 공개 화면 배포와 별개며, 기본 양식 초안은 로컬에서만 확인했다.

### 과제 인정 기간 내 커밋 날짜

- 소급 정리의 기준 커밋 `73fb3ad`까지 커미터 시각을 Asia/Seoul로 집계하면 총 **8건, 서로 다른 3일**이다. 11월 21일 2건, 22일 4건, 23일 2건이다. 같은 8건의 작성자 날짜도 일치한다.
- 확인한 과제 안내의 기준은 12주차 수업일부터 서로 다른 5일 이상이다. 기간 시작일을 확인하지 못했다. 시작일이 11월 21일 이전 또는 당일이고 세 날짜가 모두 제출 인정 기간에 속하면 **3일**, 22일이면 최대 **2일**, 23일이면 최대 **1일**, 24일 이후라면 현재 **0일**이다. 5일 요건은 현재 이력으로 충족되지 않는다.
- 오늘 추가한 소급 문서는 기록 작성일의 산출물이다. 과거 날짜의 작업이나 커밋을 새로 충족하지 않으며, 이번 문서 작성은 커밋 일수에 추가하지 않았다. 12주차 실제 수업일, 13주차 강의 내용, 날짜가 확인되지 않는 과거 화면이나 프롬프트는 추정하지 않았다.
