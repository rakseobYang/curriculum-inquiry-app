export const lessonSections = {
  objective: '학습 목표',
  concepts: '핵심 개념',
  investigationQuestion: '탐구 질문',
  investigation: '학생 직접 탐구 절차',
  record: '관찰·측정 기록 안내',
  explanation: '학생이 관찰 근거로 설명하는 방법',
  application: '새로운 실생활 문제와 적용 과제',
  assessment: '과정 평가',
  materialsAndSafety: '준비물과 안전',
  alignment: '성취기준과 수업 활동의 연결 및 교사 확인 사항',
} as const;

export type LessonSection = keyof typeof lessonSections;
export type LessonPhase = { activity: string; minutes: number };
export type LessonDraft = Record<LessonSection, string> & {
  phases: LessonPhase[];
  recordingTable: { columns: string[]; rowCount: number };
};
export type OfficialStandard = {
  code: string;
  curriculum: '2022';
  official_source: string;
  official_text: string;
  dataset_commit: string;
  verified: true;
};

export function lessonPrompt(standard: OfficialStandard, input: {
  lesson: number;
  totalLessons: number;
  minutes: number;
  equipment: string[];
  studentConditions: string;
}) {
  const instructions = [
    '중학교 과학 교사를 위한 수업안 초안을 한국어 JSON 객체로 작성한다.',
    '이 응답은 2022 개정 교육과정 공식 성취기준만을 기반으로 한다. 교과서 연계 결과라고 부르지 않는다.',
    '성취기준 공식 원문은 그대로 제공되는 값이며, AI가 작성한 모든 수업 문안과 구분한다.',
    '없는 쪽수, 교과서 제목, 출처, 관찰·측정 결과를 만들지 않는다.',
    '실험·조사 활동은 설계 제안으로 표현한다. 실제 결과를 예측값이나 사실처럼 쓰지 않는다.',
    '학생이 직접 자료를 수집하고 그 자료를 써서 설명하며, 새로운 실생활 상황에 적용하게 한다.',
    '시간·장비·학급 조건을 반영한다. 안전 조건이 부족하면 교사 확인 사항에 적는다.',
    '전체 차시 수 중 지정한 한 차시만 설계하고, 성취기준 전체의 수행을 보장하지 않는다.',
    '모든 텍스트는 3000자 이내로 하고 결과만 JSON으로 출력한다.',
    'recordingTable은 열 제목 2~5개, 빈 기록 행 2~8개다. 실제 측정값이나 예시값은 포함하지 않는다.',
    'phases는 양의 정수 분으로 구성하고 합계는 입력한 수업 시간과 같다.',
    'alignment에는 교과서 근거가 제공되지 않았다는 점과 교사가 공식 기준·과학 내용·탐구의 타당성을 검토해야 함을 명시한다.',
  ].join('\n');
  const content = JSON.stringify({
    generationMode: 'official-curriculum-only',
    officialStandard: { code: standard.code, text: standard.official_text, source: standard.official_source },
    designedLesson: input.lesson,
    totalLessons: input.totalLessons,
    minutes: input.minutes,
    equipment: input.equipment,
    studentConditions: input.studentConditions,
    textbookEvidence: null,
  });
  return { instructions, content };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, max = 3000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function validateLessonDraft(value: unknown, plannedMinutes: number): LessonDraft | undefined {
  if (!isObject(value)) return;
  const draft = {} as Record<LessonSection, string>;
  for (const key of Object.keys(lessonSections) as LessonSection[]) {
    if (!boundedText(value[key])) return;
    draft[key] = (value[key] as string).trim();
  }
  if (!Array.isArray(value.phases) || value.phases.length < 1 || value.phases.length > 12) return;
  const phases: LessonPhase[] = [];
  for (const item of value.phases) {
    if (!isObject(item) || !boundedText(item.activity, 500) || typeof item.minutes !== 'number' ||
        !Number.isSafeInteger(item.minutes) || item.minutes < 1) return;
    phases.push({ activity: item.activity.trim(), minutes: item.minutes });
  }
  if (phases.reduce((total, phase) => total + phase.minutes, 0) !== plannedMinutes) return;
  if (!isObject(value.recordingTable) || !Array.isArray(value.recordingTable.columns) ||
      value.recordingTable.columns.length < 2 || value.recordingTable.columns.length > 5 ||
      typeof value.recordingTable.rowCount !== 'number' || !Number.isInteger(value.recordingTable.rowCount) ||
      value.recordingTable.rowCount < 2 || value.recordingTable.rowCount > 8) return;
  const columns = value.recordingTable.columns;
  if (!columns.every(column => boundedText(column, 60))) return;
  const cleanColumns = columns.map(column => (column as string).trim());
  if (new Set(cleanColumns).size !== cleanColumns.length) return;
  return { ...draft, phases, recordingTable: { columns: cleanColumns, rowCount: value.recordingTable.rowCount } };
}
