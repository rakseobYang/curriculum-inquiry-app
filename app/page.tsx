import LessonEditor from './lesson-editor';

export default function Page() {
  return <main>
    <header className="app-intro">
      <div className="orbit-field" aria-hidden="true"><span /></div>
      <h1>과학 탐구 수업 설계기</h1>
      <p>작은 질문에서 시작하는 과학의 발견</p>
      <ol className="workflow" aria-label="수업안 작성 순서">
        <li>성취기준 선택</li><li>조건 입력</li><li>생성·검토</li><li>저장</li>
      </ol>
      <nav className="controls" aria-label="수업안 작업"><a href="#lesson-form">수업안 작성</a><a href="#saved-plans">저장한 수업안 열기</a></nav>
    </header>
    <LessonEditor />
  </main>;
}
