export type Standard = {
  code: string;
  curriculum: '2022';
  officialSource: string;
  officialText: string;
  verified: boolean;
  apiAllowed: boolean;
};

export type TextbookEvidence = {
  id: string;
  volume: 1 | 2 | 3;
  revision: '2015' | '2022';
  editionId: string;
  unitId: string;
  lesson: number | null;
  lessonEnd?: number;
  totalUnitLessons?: number;
  lessonBasis: 'publisher' | 'teacher' | 'unassigned';
  printedPages: [number, number];
  standardCodes: string[];
  verified: boolean;
  apiAllowed: boolean;
  approvedSummary: string;
  sourceUrl?: string;
  alignmentScope?: string;
  supportsEntireStandard?: boolean;
};

export type LessonInput = {
  evidenceId: string;
  standardCode: string;
  volume: 1 | 2 | 3;
  editionId: string;
  unitId: string;
  lesson: number;
  totalLessons: number;
  minutes: number;
  equipment: string[];
  studentConditions?: string;
};

// Read trusted catalog records on the server before constructing an API request.
export function selectEvidence(input: LessonInput, standard: Standard | undefined, catalog: TextbookEvidence[]) {
  if (!Number.isInteger(input.lesson) || !Number.isInteger(input.totalLessons) ||
      input.lesson < 1 || input.lesson > input.totalLessons ||
      !Number.isInteger(input.minutes) || input.minutes < 1) {
    return { status: 'invalid-input' } as const;
  }
  if (!standard?.verified || standard.code !== input.standardCode ||
      standard.curriculum !== '2022' || !standard.officialSource.trim() ||
      !standard.officialText.trim()) {
    return { status: 'standard-unverified' } as const;
  }
  const scope = catalog.filter(row => row.id === input.evidenceId && row.volume === input.volume &&
    row.revision === (input.volume === 3 ? '2015' : '2022') &&
    row.editionId === input.editionId && row.unitId === input.unitId &&
    (row.lesson === null
      ? row.lessonBasis === 'unassigned' && row.lessonEnd === undefined
      : row.lessonBasis !== 'unassigned' && row.lesson <= input.lesson &&
        input.lesson <= (row.lessonEnd ?? row.lesson) && (row.lessonEnd ?? row.lesson) <= input.totalLessons) &&
    row.verified &&
    row.standardCodes.includes(standard.code) &&
    row.printedPages.every(page => Number.isInteger(page) && page > 0) &&
    row.printedPages[0] <= row.printedPages[1]);
  if (scope.length === 0) return { status: 'textbook-unverified' } as const;
  if (scope.some(row => row.totalUnitLessons !== undefined && row.totalUnitLessons !== input.totalLessons)) {
    return { status: 'invalid-input' } as const;
  }

  const approved = scope.filter(row => row.apiAllowed && row.approvedSummary.trim());
  if (!standard.apiAllowed || approved.length === 0) {
    return { status: 'transfer-not-approved' } as const;
  }
  return {
    status: 'ready',
    references: approved,
    // Store/display reference metadata separately from the model payload.
    modelEvidence: {
      standard: { code: standard.code, text: standard.officialText },
      textbook: approved.map(({ id, approvedSummary }) => ({ id, summary: approvedSummary })),
    },
  } as const;
}
