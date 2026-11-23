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
