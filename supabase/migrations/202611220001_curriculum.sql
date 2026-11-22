create table public.curriculum_standards (
  code text primary key,
  curriculum text not null default '2022' check (curriculum = '2022'),
  official_source text not null,
  official_text text not null,
  dataset_commit text not null,
  verified boolean not null default false,
  api_allowed boolean not null default false,
  check (not verified or (btrim(official_source) <> '' and btrim(official_text) <> ''))
);

create table public.textbook_evidence (
  id uuid primary key default gen_random_uuid(),
  volume smallint not null check (volume between 1 and 3),
  revision text not null,
  edition_id text not null,
  unit_id text not null,
  lesson integer check (lesson > 0),
  lesson_end integer check (lesson_end >= lesson),
  total_unit_lessons integer check (total_unit_lessons >= coalesce(lesson_end, lesson, 1)),
  lesson_basis text not null check (lesson_basis in ('publisher', 'teacher', 'unassigned')),
  check ((lesson_basis = 'unassigned' and lesson is null and lesson_end is null) or
    (lesson_basis <> 'unassigned' and lesson is not null)),
  printed_page_start integer not null check (printed_page_start > 0),
  printed_page_end integer not null check (printed_page_end >= printed_page_start),
  source_url text,
  verified boolean not null default false,
  display_allowed boolean not null default false,
  api_allowed boolean not null default false,
  approved_summary text not null default '',
  check (revision = case when volume = 3 then '2015' else '2022' end),
  check (not api_allowed or (verified and display_allowed and btrim(approved_summary) <> ''))
);

create index textbook_evidence_scope on public.textbook_evidence (volume, edition_id, unit_id, lesson);

create table public.textbook_standard_links (
  evidence_id uuid not null references public.textbook_evidence(id) on delete cascade,
  standard_code text not null references public.curriculum_standards(code),
  alignment_scope text check (alignment_scope is null or char_length(btrim(alignment_scope)) between 1 and 200),
  supports_entire_standard boolean,
  primary key (evidence_id, standard_code)
);

create table public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  standard_code text not null references public.curriculum_standards(code),
  title text not null check (btrim(title) <> ''),
  editor_state jsonb not null check (jsonb_typeof(editor_state) = 'object'),
  created_at timestamptz not null default now()
);

create index lesson_plans_teacher on public.lesson_plans (teacher_id, created_at desc);

alter table public.curriculum_standards enable row level security;
alter table public.textbook_evidence enable row level security;
alter table public.textbook_standard_links enable row level security;
alter table public.lesson_plans enable row level security;

revoke all on public.curriculum_standards, public.textbook_evidence,
  public.textbook_standard_links, public.lesson_plans from anon, authenticated;
grant select on public.curriculum_standards to authenticated;
grant select, insert, update, delete on public.lesson_plans to authenticated;

create policy read_verified_standards on public.curriculum_standards
  for select to authenticated using (verified);
create policy manage_own_plans on public.lesson_plans
  for all to authenticated using ((select auth.uid()) = teacher_id)
  with check ((select auth.uid()) = teacher_id);
