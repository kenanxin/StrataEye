-- Additive contract only. Applying this migration to a real project is a separate operation.
create table if not exists public.mine_workflow_runs (
  workflow_run_id text primary key,
  revision bigint not null check (revision between 0 and 9007199254740991),
  record_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  state jsonb not null check (jsonb_typeof(state) = 'object')
);
create index if not exists mine_workflow_runs_recent_idx
  on public.mine_workflow_runs (updated_at desc, workflow_run_id);
create index if not exists mine_workflow_runs_record_recent_idx
  on public.mine_workflow_runs (record_id, updated_at desc, workflow_run_id);

create table if not exists public.mine_workflow_commands (
  workflow_run_id text not null references public.mine_workflow_runs(workflow_run_id),
  command_id text not null,
  revision bigint not null,
  saved_state jsonb not null,
  event jsonb,
  created_at timestamptz not null default now(),
  primary key (workflow_run_id, command_id),
  unique (workflow_run_id, revision)
);
alter table public.mine_workflow_runs enable row level security;
alter table public.mine_workflow_commands enable row level security;
revoke all on public.mine_workflow_runs, public.mine_workflow_commands from public, anon, authenticated;
-- Only RPCs mutate. Service-role reads support bounded get/list over PostgREST.
revoke all on public.mine_workflow_runs, public.mine_workflow_commands from service_role;
grant select on public.mine_workflow_runs to service_role;

create or replace function public.mine_workflow_validate(p_run jsonb)
returns void language plpgsql set search_path = pg_catalog, public as $$
declare
  v_field text;
  v_created timestamptz;
  v_updated timestamptz;
begin
  if jsonb_typeof(p_run) is distinct from 'object'
    or (p_run->>'workflow_run_id') is null
    or (p_run->>'workflow_run_id') !~ '^WF-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_run->'revision') is distinct from 'number'
    or (p_run->>'revision') !~ '^[0-9]+$'
    or jsonb_typeof(p_run->'algorithm') is distinct from 'object'
    or jsonb_typeof(p_run->'algorithm'->'record_id') is distinct from 'string'
    or length(btrim(p_run->'algorithm'->>'record_id')) not between 1 and 256
    or length(p_run->'algorithm'->>'record_id') > 256
    or jsonb_typeof(p_run->'phase') is distinct from 'string'
    or length(btrim(p_run->>'phase')) not between 1 and 128
    or length(p_run->>'phase') > 128
    or jsonb_typeof(p_run->'demo_state') is distinct from 'object'
    or octet_length(p_run::text) > 4194304 then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  if (p_run->>'revision')::numeric > 9007199254740991 then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  foreach v_field in array array['created_at', 'updated_at'] loop
    if jsonb_typeof(p_run->v_field) is distinct from 'string'
      or (p_run->>v_field) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then
      raise exception using message = 'WORKFLOW_INVALID_INPUT';
    end if;
  end loop;
  begin
    v_created := (p_run->>'created_at')::timestamptz;
    v_updated := (p_run->>'updated_at')::timestamptz;
  exception when others then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end;
  if v_updated < v_created
    or to_char(v_created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') <> left(p_run->>'created_at', 19)
    or to_char(v_updated at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') <> left(p_run->>'updated_at', 19) then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  foreach v_field in array array['nodes', 'plan_versions', 'feedback', 'case_memory', 'events'] loop
    if jsonb_typeof(p_run->v_field) is distinct from 'array' then
      raise exception using message = 'WORKFLOW_INVALID_INPUT';
    end if;
    if exists (select 1 from jsonb_array_elements(p_run->v_field) as item where jsonb_typeof(item) <> 'object') then
      raise exception using message = 'WORKFLOW_INVALID_INPUT';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_run->'events') as item
    where jsonb_typeof(item->'type') is distinct from 'string' or length(btrim(item->>'type')) not between 1 and 128 or length(item->>'type') > 128) then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
end;
$$;
revoke all on function public.mine_workflow_validate(jsonb) from public, anon, authenticated, service_role;

create or replace function public.mine_workflow_validate_stored(p_state jsonb, p_id text, p_revision bigint)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  perform public.mine_workflow_validate(p_state);
  if (p_state->>'workflow_run_id') is distinct from p_id
    or (p_state->>'revision')::bigint is distinct from p_revision then
    raise exception using message = 'WORKFLOW_CORRUPT_DATA';
  end if;
exception when others then
  raise exception using message = 'WORKFLOW_CORRUPT_DATA';
end;
$$;
revoke all on function public.mine_workflow_validate_stored(jsonb, text, bigint) from public, anon, authenticated, service_role;

create or replace function public.mine_workflow_create(p_run jsonb, p_command_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_id text := p_run->>'workflow_run_id';
  v_state jsonb;
  v_saved jsonb;
  v_revision bigint;
  v_saved_revision bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception using message = 'WORKFLOW_FORBIDDEN'; end if;
  if v_id is null or v_id !~ '^WF-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command_id is null or p_command_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  -- Serialize creation even before there is a row to lock. Hash collisions only serialize unrelated IDs.
  perform pg_advisory_xact_lock(hashtextextended(v_id, 0));
  select state, revision into v_state, v_revision from public.mine_workflow_runs where workflow_run_id = v_id for update;
  if found then perform public.mine_workflow_validate_stored(v_state, v_id, v_revision); end if;
  select saved_state, revision into v_saved, v_saved_revision from public.mine_workflow_commands where workflow_run_id = v_id and command_id = p_command_id;
  if found then
    perform public.mine_workflow_validate_stored(v_saved, v_id, v_saved_revision);
    return v_saved;
  end if;
  if v_state is not null then raise exception using message = 'WORKFLOW_CONFLICT'; end if;
  perform public.mine_workflow_validate(p_run);
  if (p_run->>'revision')::bigint <> 0 then raise exception using message = 'WORKFLOW_INVALID_INPUT'; end if;
  insert into public.mine_workflow_runs (workflow_run_id, revision, record_id, created_at, updated_at, state)
    values (v_id, 0, p_run->'algorithm'->>'record_id', (p_run->>'created_at')::timestamptz, (p_run->>'updated_at')::timestamptz, p_run);
  insert into public.mine_workflow_commands (workflow_run_id, command_id, revision, saved_state)
    values (v_id, p_command_id, 0, p_run);
  return p_run;
end;
$$;

create or replace function public.mine_workflow_save(p_run jsonb, p_expected_revision jsonb, p_command_id text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_id text := p_run->>'workflow_run_id';
  v_state jsonb;
  v_saved jsonb;
  v_revision bigint;
  v_expected_revision bigint;
  v_saved_revision bigint;
  v_events jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception using message = 'WORKFLOW_FORBIDDEN'; end if;
  if v_id is null or v_id !~ '^WF-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command_id is null or p_command_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  select state, revision into v_state, v_revision from public.mine_workflow_runs where workflow_run_id = v_id for update;
  if not found then raise exception using message = 'WORKFLOW_NOT_FOUND'; end if;
  perform public.mine_workflow_validate_stored(v_state, v_id, v_revision);
  -- Durable idempotency precedes validation of the retry's proposed state/revision.
  select saved_state, revision into v_saved, v_saved_revision from public.mine_workflow_commands where workflow_run_id = v_id and command_id = p_command_id;
  if found then
    perform public.mine_workflow_validate_stored(v_saved, v_id, v_saved_revision);
    return v_saved;
  end if;
  if jsonb_typeof(p_expected_revision) is distinct from 'number' or p_expected_revision::text !~ '^[0-9]+$' then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  if p_expected_revision::text::numeric >= 9007199254740991 then raise exception using message = 'WORKFLOW_INVALID_INPUT'; end if;
  v_expected_revision := p_expected_revision::text::bigint;
  perform public.mine_workflow_validate(p_run);
  if (p_run->>'revision')::bigint <> v_expected_revision + 1
    or jsonb_typeof(p_event) is distinct from 'object'
    or jsonb_typeof(p_event->'type') is distinct from 'string'
    or length(btrim(p_event->>'type')) not between 1 and 128
    or length(p_event->>'type') > 128 then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  if v_revision <> v_expected_revision then raise exception using message = 'WORKFLOW_CONFLICT'; end if;
  if (p_run->>'created_at') is distinct from (v_state->>'created_at')
    or (p_run->>'updated_at')::timestamptz < (v_state->>'updated_at')::timestamptz then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  v_events := (v_state->'events') || jsonb_build_array(p_event);
  if (p_run->'events') is distinct from (v_state->'events') and (p_run->'events') is distinct from v_events then
    raise exception using message = 'WORKFLOW_INVALID_INPUT';
  end if;
  v_saved := jsonb_set(p_run, '{events}', v_events);
  perform public.mine_workflow_validate(v_saved);
  update public.mine_workflow_runs set revision = v_expected_revision + 1,
    record_id = v_saved->'algorithm'->>'record_id', updated_at = (v_saved->>'updated_at')::timestamptz, state = v_saved
    where workflow_run_id = v_id;
  insert into public.mine_workflow_commands (workflow_run_id, command_id, revision, saved_state, event)
    values (v_id, p_command_id, v_expected_revision + 1, v_saved, p_event);
  return v_saved;
end;
$$;

revoke all on function public.mine_workflow_create(jsonb, text) from public, anon, authenticated;
revoke all on function public.mine_workflow_save(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.mine_workflow_create(jsonb, text) to service_role;
grant execute on function public.mine_workflow_save(jsonb, jsonb, text, jsonb) to service_role;
