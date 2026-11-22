create function public.find_textbook_evidence(requested_standard text)
returns table (
  id uuid, volume smallint, revision text, edition_id text, unit_id text,
  lesson integer, lesson_end integer, total_unit_lessons integer, lesson_basis text, printed_page_start integer,
  printed_page_end integer, source_url text, generation_available boolean,
  alignment_scope text, supports_entire_standard boolean
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.volume, e.revision, e.edition_id, e.unit_id,
    e.lesson, coalesce(e.lesson_end, e.lesson), e.total_unit_lessons, e.lesson_basis, e.printed_page_start, e.printed_page_end,
    e.source_url, (e.api_allowed and s.api_allowed), l.alignment_scope, l.supports_entire_standard
  from public.textbook_evidence e
  join public.textbook_standard_links l on l.evidence_id = e.id
  join public.curriculum_standards s on s.code = l.standard_code
  where auth.uid() is not null and s.code = requested_standard
    and s.verified and e.verified and e.display_allowed
  order by e.volume, e.edition_id, e.unit_id, e.lesson, e.printed_page_start, e.id;
$$;

revoke all on function public.find_textbook_evidence(text) from public, anon;
grant execute on function public.find_textbook_evidence(text) to authenticated;
