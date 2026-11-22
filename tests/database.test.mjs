import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL migrations isolate lesson plans and expose only eligible source metadata', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      grant usage on schema auth to authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      insert into auth.users values
        ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
    `);
    for (const name of ['202611220001_curriculum.sql', '202611220002_evidence_lookup.sql', '202611220003_generation_limit.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    }
    await db.exec(`
      insert into curriculum_standards(code, official_source, official_text, dataset_commit, verified, api_allowed)
      values ('test', 'fixture', 'fixture', 'fixture', true, true);
      insert into textbook_evidence(volume, revision, edition_id, unit_id, lesson, lesson_end, lesson_basis,
        printed_page_start, printed_page_end, verified, display_allowed, api_allowed, approved_summary)
      values (3, '2015', 'visible', 'unit', 2, 3, 'publisher', 14, 18, true, true, true, 'private fixture'),
        (3, '2015', 'hidden', 'unit', 2, 3, 'publisher', 14, 18, true, false, false, '');
      insert into textbook_standard_links(evidence_id, standard_code, alignment_scope, supports_entire_standard)
      select id, 'test', '가상 부분 범위', false from textbook_evidence;
    `);
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from find_textbook_evidence('test')"), { code: '42501' });
    await db.exec("reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
    await assert.rejects(db.query('select * from textbook_evidence'), { code: '42501' });
    const { rows } = await db.query("select * from find_textbook_evidence('test')");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].edition_id, 'visible');
    assert.equal(rows[0].lesson_end, 3);
    assert.equal(rows[0].generation_available, true);
    assert.equal(rows[0].alignment_scope, '가상 부분 범위');
    assert.equal(rows[0].supports_entire_standard, false);
    assert.ok(!Object.hasOwn(rows[0], 'approved_summary'));
    const planId = '00000000-0000-0000-0000-000000000011';
    const upsert = `insert into lesson_plans(id,standard_code,title,editor_state) values ($1,'test',$2,'{}')
      on conflict (id) do update set title = excluded.title, editor_state = excluded.editor_state returning id`;
    await db.query(upsert, [planId, 'one']);
    await db.query(upsert, [planId, 'updated after retry']);
    assert.deepEqual((await db.query('select id,title from lesson_plans')).rows,
      [{ id: planId, title: 'updated after retry' }]);
    await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'");
    assert.equal((await db.query('select * from lesson_plans')).rows.length, 0);
    await assert.rejects(db.query(upsert, [planId, 'wrong owner']), /row.level security/i);
    assert.equal((await db.query("update lesson_plans set title='changed' returning id")).rows.length, 0);
    await assert.rejects(db.query(`insert into lesson_plans(teacher_id,standard_code,title,editor_state)
      values ('00000000-0000-0000-0000-000000000001','test','spoof','{}')`), { code: '42501' });
    const reserve = user => db.query('select reserve_lesson_generation($1, 2) as allowed', [user]);
    const first = '00000000-0000-0000-0000-000000000001';
    await assert.rejects(reserve(first), { code: '42501' });
    await db.exec('reset role; set role service_role');
    const attempts = await Promise.all([reserve(first), reserve(first), reserve(first)]);
    assert.deepEqual(attempts.map(result => result.rows[0].allowed), [true, true, false]);
    assert.equal((await reserve('00000000-0000-0000-0000-000000000002')).rows[0].allowed, true);
  } finally {
    await db.close();
  }
});
