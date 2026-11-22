create table public.lesson_generation_usage (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  attempts integer not null check (attempts > 0),
  primary key (teacher_id, usage_day)
);

alter table public.lesson_generation_usage enable row level security;
revoke all on public.lesson_generation_usage from public, anon, authenticated;

create function public.reserve_lesson_generation(requested_teacher uuid, daily_limit integer)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  with reservation as (
    insert into public.lesson_generation_usage as usage (teacher_id, usage_day, attempts)
    select requested_teacher, (now() at time zone 'Asia/Seoul')::date, 1
    where daily_limit between 1 and 1000
    on conflict (teacher_id, usage_day) do update
    set attempts = usage.attempts + 1
    where usage.attempts < daily_limit
    returning 1
  )
  select exists(select 1 from reservation);
$$;

revoke all on function public.reserve_lesson_generation(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_lesson_generation(uuid, integer) to service_role;
