import { validateLessonDraft } from './lesson-schema.ts';

export type StoredPlan = {
  id: string;
  title: string;
  editorState: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PlanBackup = {
  format: 'curriculum-inquiry-app-backup';
  version: 1;
  exportedAt: string;
  plans: StoredPlan[];
};

const DB_NAME = 'curriculum-inquiry-app';
const STORE_NAME = 'lesson-plans';
const BACKUP_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_PLANS = 500;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await requestResult(operation(transaction.objectStore(STORE_NAME)));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
    return result;
  } finally {
    database.close();
  }
}

export async function listPlans(): Promise<StoredPlan[]> {
  const rows = await withStore('readonly', store => store.getAll()) as StoredPlan[];
  return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function savePlan(plan: StoredPlan): Promise<IDBValidKey> {
  return withStore('readwrite', store => store.put(plan));
}

export async function savePlans(plans: StoredPlan[]): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const plan of plans) store.put(plan);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB import failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB import aborted'));
    });
  } finally {
    database.close();
  }
}

export function removePlan(id: string): Promise<undefined> {
  return withStore('readwrite', store => store.delete(id));
}

export function createBackup(plans: StoredPlan[]): PlanBackup {
  return { format: 'curriculum-inquiry-app-backup', version: 1, exportedAt: new Date().toISOString(), plans };
}

function isPlan(value: unknown): value is StoredPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<StoredPlan>;
  if (typeof row.id !== 'string' || row.id.length < 1 || row.id.length > 100 ||
      typeof row.title !== 'string' || !row.title.trim() || row.title.length > 160 ||
      typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt)) ||
      !row.editorState || typeof row.editorState !== 'object' || Array.isArray(row.editorState)) return false;
  const state = row.editorState as Record<string, unknown>;
  const standard = state.standard as Record<string, unknown> | undefined;
  const result = state.result as Record<string, unknown> | undefined;
  const officialStandard = result?.officialStandard as Record<string, unknown> | undefined;
  const plannedMinutes = result?.plannedMinutes;
  return Boolean(standard && typeof standard.code === 'string' && standard.code.length <= 30 &&
    typeof standard.official_text === 'string' && standard.official_text.length <= 500 &&
    typeof standard.official_source === 'string' && standard.official_source.length <= 500 &&
    result?.status === 'generated' && result.generationMode === 'official-curriculum-only' &&
    result.alignmentStatus === 'teacher-review' && Array.isArray(result.references) && result.references.length === 0 &&
    Number.isSafeInteger(plannedMinutes) && (plannedMinutes as number) > 0 &&
    officialStandard?.code === standard.code &&
    validateLessonDraft(result.draft, plannedMinutes as number) !== undefined);
}

export async function parseBackup(file: File): Promise<StoredPlan[]> {
  if (file.size > BACKUP_LIMIT_BYTES) throw new Error('백업 파일은 5MB 이하만 복원할 수 있습니다.');
  const backup: unknown = JSON.parse(await file.text());
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('백업 파일 형식이 올바르지 않습니다.');
  const data = backup as Partial<PlanBackup>;
  if (data.format !== 'curriculum-inquiry-app-backup' || data.version !== 1 || !Array.isArray(data.plans) ||
      data.plans.length > MAX_PLANS || !data.plans.every(isPlan)) {
    throw new Error('지원하지 않거나 손상된 백업 파일입니다. 기존 저장 자료는 변경하지 않았습니다.');
  }
  if (new Set(data.plans.map(plan => plan.id)).size !== data.plans.length) {
    throw new Error('백업에 중복된 수업안 ID가 있습니다. 기존 저장 자료는 변경하지 않았습니다.');
  }
  return data.plans;
}
