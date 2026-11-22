import LessonEditor from './lesson-editor';

export const dynamic = 'force-dynamic';

export default function Page() {
  const anon = process.env.SUPABASE_ANON_KEY ?? '';
  let role: unknown;
  try {
    role = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString()).role;
  } catch { /* Publishable keys are not JWTs. */ }
  const publicKey = anon !== process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (anon.startsWith('sb_publishable_') || role === 'anon') ? anon : '';
  return <main>
    <h1>과학 탐구 수업 설계기</h1>
    <LessonEditor url={process.env.SUPABASE_URL ?? ''} anon={publicKey} />
  </main>;
}
