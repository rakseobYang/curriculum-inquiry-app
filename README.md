# 교육과정 기반 과학 탐구 수업 설계기

2022 개정 중학교 과학 성취기준을 검색하고, 선택한 기준과 교사 입력을 바탕으로 **공식 교육과정 기반** 수업안 초안을 작성하는 앱입니다. 교과서 자료는 현재 표시·외부 전송 권한이 확인되지 않아 검색 결과와 생성 근거에서 제외합니다. 따라서 교과서 연계 생성은 제공하지 않습니다. 과학 3의 PDF는 2015 개정 자료 참고용이며 2022 개정 교과서로 표시하지 않습니다.

## 현재 구조와 상태

- Next.js 정적 내보내기, GitHub Pages의 `/curriculum-inquiry-app/` 하위 경로 배포용입니다.
- 로그인 없이 사용합니다. 수업안 목록·검색·작성·수정·삭제·백업·복원은 이 브라우저의 IndexedDB에만 저장합니다. 브라우저 데이터 삭제 시 사라질 수 있으므로 백업 파일을 별도 보관하세요.
- 실시간 생성은 Cloudflare Worker의 Workers AI 바인딩을 사용합니다. 수업안은 IndexedDB에, 서버 사용량 카운터는 SQLite Durable Object에 저장합니다.
- 공개 API는 Turnstile 검증, 입력/출력 제한, 시간 초과, Durable Object 기반 IP·전체 사용량 한도를 적용하도록 구성했습니다. CORS는 비용 제한으로 간주하지 않습니다.
- Worker, Turnstile, Workers AI, GitHub Pages 실서비스는 연결 확인이 필요합니다. 화면 자동 검증에는 모의 응답을 사용합니다.
- 공개 데이터에는 검증된 2022 과학 성취기준만 포함합니다. PDF, 추출 텍스트, 교과서 카탈로그는 정적 배포 산출물에 넣지 않습니다.

## 로컬 실행과 검증 (PowerShell)

```powershell
cd "C:\Users\충청북도교육청\Desktop\교대원(AI 에이전트)\기말과제\curriculum-inquiry-app\curriculum-inquiry-app"
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run check:pages
npm.cmd run test:mobile
npm.cmd run dev
```

개발 서버 주소는 `http://localhost:3000/curriculum-inquiry-app/`입니다. `test:mobile`은 빌드 산출물을 GitHub Pages 하위 경로처럼 제공하고 Edge 360px에서 실행합니다. Turnstile과 Worker 응답은 가상으로 대체하므로 실제 서비스 연결을 검증하지 않습니다. 테스트 빌드에는 테스트용 공개 설정이 주입되므로 마친 뒤 `npm.cmd run build`를 실행해 배포용 산출물을 다시 만드세요.

## 서비스 연결 준비

일반 빌드는 저장소의 공개 성취기준 JSON을 사용합니다. `npm.cmd run standards:refresh`는 검증된 비공개 SQL이 있는 환경에서 공개 JSON을 갱신할 때만 실행합니다. Actions는 `out/`을 검사한 뒤 업로드합니다.

운영 Turnstile 위젯의 호스트는 `rakseobyang.github.io`입니다. 로컬에서 실제 Turnstile을 확인하려면 `localhost`를 허용한 별도 위젯과 별도 로컬 Worker 설정을 사용합니다. 로컬 Worker의 허용 Origin은 `http://localhost:3000`입니다. `127.0.0.1`을 쓰는 경우에는 위젯 호스트와 Origin도 그 주소에 맞춥니다.

1. Cloudflare 계정에서 Worker를 준비하고, Pages 호스트용 Turnstile 사이트 키와 비밀 키를 별도로 발급합니다.
2. `workers/wrangler.jsonc`의 허용 Origin을 실제 Pages 주소와 대조합니다. 기본값은 `https://rakseobyang.github.io`입니다.
3. Workers Free 플랜에서 `AI` 바인딩을 사용합니다. Worker Secrets에 `TURNSTILE_SECRET_KEY`와 충분히 긴 임의 값인 `RATE_LIMIT_HMAC_KEY`를 직접 입력합니다. 비밀값은 채팅, 브라우저 환경변수, Git에 넣지 마세요.
4. Worker를 배포하고 실제 Worker URL과 Turnstile 공개 사이트 키를 GitHub 저장소 Actions Variables `CLOUDFLARE_WORKER_URL`, `TURNSTILE_SITE_KEY`에 등록합니다. 비밀값을 Actions Variables에 두지 않습니다.
5. GitHub 저장소 Settings에서 Pages 배포 원본을 GitHub Actions로 설정합니다. 실제 계정 설정 이후에만 Pages 배포 및 실제 AI 검증을 진행합니다.

Workers Free의 Workers AI 무료 할당량은 계정 전체 하루 10,000 Neurons이며 UTC 자정에 초기화됩니다. 앱 자체 한도는 IP 기준 하루 20회, 전체 하루 100회입니다. 무료 할당량이 소진되면 생성 요청이 실패할 수 있습니다. [Workers AI 요금](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## 자료 및 개발 기록

- [개발 계획](DEVELOPMENT_PLAN.md): 이전 Supabase/Vercel 설계 기록과 현재 Pages/Workers 전환 상태
- [자료 현황](SOURCE_INVENTORY.md): 확보 자료, 공개 제외, 판본 및 권한 구분
- [검증 체크리스트](CHECKLIST.md): 통과·미완료 항목 및 실제/모의 구분
- [개발 기록](evidence/): 실행 결과와 미해결 의존 사항

로컬 설정 파일 `.env.local`에는 공개 Worker URL과 Turnstile 공개 키를 설정합니다. Turnstile 비밀키와 사용량 제한용 키는 서버에서 관리합니다.
