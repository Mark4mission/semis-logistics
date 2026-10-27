/* ═══════════════════════════════════════════════════════
   H:drive — 접수 카운터 직원 접수함 (v1.59)
   - 내부 직원(admin · hq · manager · user)이 접수 카운터에 올린 파일을 한 줄씩 적는다. 원본은 저장소 desk-in/ 폴더
     (Edge semis-logi-files: 올리기 1 · 열람 3, 협력업체 · 서명 세션은 올리기 불가).
   - 안전보안파트(hq) 이상 화면이 접수함을 가져가(take — 한 사람만, 10분 넘게 멈춘 것은 다시) 내용 확인 · 저장한 뒤
     닫는다(close: done 저장됨 · kept 보관 · back 반려).
   - 올린 사람은 본인 것만 본다(상태 · 처리 결과 = 저장한 화면 이름). 확인 전(new)이면 취소할 수 있다.
   - 공용 행(semis_logi_store)에는 넣지 않는다 — 직원 이름 · 파일 이름은 이 비공개 표에만. 처리 끝난 줄은 180일 뒤 지운다.
   - 같이 바꾸는 것: public.semis_logi_file_auth() 가 role 도 돌려준다(Edge 가 desk-in 올리기를 내부 직원으로 한정).
   - 실제 적용은 마이그레이션 semis_logi_desk_inbox. 이 파일이 원본(다시 실행해도 같은 결과).
   ═══════════════════════════════════════════════════════ */

create table if not exists semis_logi_private.desk_inbox (
  id         bigserial primary key,
  account_id text not null,
  by_name    text not null default '',
  at         timestamptz not null default now(),
  path       text not null unique,                  -- desk-in/<태그>_<파일 이름>
  name       text not null default '',
  size       bigint not null default 0,
  ftype      text not null default '',              -- 화면이 본 종류(pdf · image · text · hwp · xls · legacy · other)
  note       text not null default '',
  status     text not null default 'new' check (status in ('new', 'taken', 'done', 'kept', 'back', 'cancel')),
  result     text not null default '',              -- 저장한 화면 이름만(예: '일정 · 교육 이수 기록')
  taken_by   text,
  taken_at   timestamptz,
  done_by    text,
  done_at    timestamptz
);
create index if not exists desk_inbox_status on semis_logi_private.desk_inbox(status, at);
create index if not exists desk_inbox_mine on semis_logi_private.desk_inbox(account_id, at desc);
alter table semis_logi_private.desk_inbox enable row level security;
revoke all on semis_logi_private.desk_inbox from public, anon, authenticated;
revoke all on sequence semis_logi_private.desk_inbox_id_seq from public, anon, authenticated;

/* 지금 세션 — 내부 직원만(협력업체 · 서명 세션 제외) */
create or replace function semis_logi_private.desk_me() returns table(account_id text, name text, role text, rank int)
language sql stable security definer set search_path = '' as $$
  select c.account_id, coalesce(nullif(c.name, ''), c.login_id), c.role, c.rank
    from semis_logi_private.ctx() c
   where c.kind = 'user' and c.account_id is not null and c.role in ('admin', 'hq', 'manager', 'user')
   limit 1
$$;
/* 열린 화면에 알림(내용 없이 키만) — 실패해도 저장은 그대로 */
create or replace function semis_logi_private.desk_notify() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('key', 'desk:in', 'by', '', 'at', now()), 'change', 'semis-logi-sync', false);
exception when others then
  null;
end $$;
/* 올린 사람이 보는 한 줄 */
create or replace function semis_logi_private.desk_mine_row(x semis_logi_private.desk_inbox) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'at', x.at, 'name', x.name, 'size', x.size, 'status', x.status,
    'result', case when x.status = 'done' then x.result else '' end, 'done_at', x.done_at)
$$;
/* 저장소에 실제로 올라간 원본인지(하루 안) — 남의 경로 · 지어낸 경로로 줄을 만들지 못하게 */
create or replace function semis_logi_private.desk_file_ok(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from storage.objects o
                  where o.bucket_id = 'semis-logi-files' and o.name = p_path and o.created_at > now() - interval '1 day');
exception when others then
  return false;
end $$;

/* ─── 직원: 올리기 한 줄 ─── */
create or replace function public.semis_logi_desk_submit(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; r semis_logi_private.desk_inbox; v_path text; v_name text; v_size bigint; v_type text; v_n int;
begin
  select * into c from semis_logi_private.desk_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  v_path := coalesce(p ->> 'path', '');
  if v_path !~ '^desk-in/[a-z0-9]{12,24}_[A-Za-z0-9._-]{1,80}$' then return jsonb_build_object('ok', false, 'error', 'path'); end if;
  v_name := left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '[[:cntrl:]]', '', 'g')), 160);
  if v_name = '' then v_name := 'file'; end if;
  v_size := case when coalesce(p ->> 'size', '') ~ '^[0-9]{1,12}$' then (p ->> 'size')::bigint else 0 end;
  v_type := case when coalesce(p ->> 'ftype', '') ~ '^[a-z]{1,12}$' then p ->> 'ftype' else '' end;
  select count(*) into v_n from semis_logi_private.desk_inbox where account_id = c.account_id and at > now() - interval '1 hour';
  if v_n >= 30 then return jsonb_build_object('ok', false, 'error', 'rate'); end if;
  if exists (select 1 from semis_logi_private.desk_inbox where path = v_path) then return jsonb_build_object('ok', false, 'error', 'dup'); end if;
  if not semis_logi_private.desk_file_ok(v_path) then return jsonb_build_object('ok', false, 'error', 'file'); end if;
  insert into semis_logi_private.desk_inbox(account_id, by_name, path, name, size, ftype)
  values (c.account_id, left(coalesce(c.name, ''), 60), v_path, v_name, v_size, v_type)
  returning * into r;
  delete from semis_logi_private.desk_inbox
   where status in ('done', 'kept', 'back', 'cancel') and coalesce(done_at, at) < now() - interval '180 days';
  perform semis_logi_private.desk_notify();
  return jsonb_build_object('ok', true, 'item', semis_logi_private.desk_mine_row(r));
end $$;

/* ─── 직원: 내가 올린 문서(60일 · 100건) ─── */
create or replace function public.semis_logi_desk_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.desk_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(semis_logi_private.desk_mine_row(x) order by x.at desc)
      from (select * from semis_logi_private.desk_inbox
             where account_id = c.account_id and at > now() - interval '60 days'
             order by at desc limit 100) x), '[]'::jsonb));
end $$;

/* ─── 직원: 확인 전이면 취소 ─── */
create or replace function public.semis_logi_desk_cancel(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.desk_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update semis_logi_private.desk_inbox set status = 'cancel', done_at = now(), done_by = left(coalesce(c.name, ''), 60)
   where id = p_id and account_id = c.account_id and status = 'new';
  if not found then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  perform semis_logi_private.desk_notify();
  return jsonb_build_object('ok', true);
end $$;

/* ─── 안전보안파트: 확인할 접수(새 것 · 10분 넘게 멈춘 것) ─── */
create or replace function public.semis_logi_desk_inbox() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.desk_me();
  if not found or c.rank < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'by', x.by_name, 'path', x.path, 'name', x.name,
                                        'size', x.size, 'ftype', x.ftype, 'note', x.note) order by x.at)
      from (select * from semis_logi_private.desk_inbox
             where status = 'new' or (status = 'taken' and taken_at < now() - interval '10 minutes')
             order by at limit 50) x), '[]'::jsonb));
end $$;

/* ─── 안전보안파트: 가져가기(한 사람만) ─── */
create or replace function public.semis_logi_desk_take(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.desk_me();
  if not found or c.rank < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update semis_logi_private.desk_inbox set status = 'taken', taken_by = left(coalesce(c.name, ''), 60), taken_at = now()
   where id = p_id and (status = 'new' or (status = 'taken' and taken_at < now() - interval '10 minutes'));
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  return jsonb_build_object('ok', true);
end $$;

/* ─── 안전보안파트: 처리 끝(저장됨 · 보관 · 반려). 같은 상태로 다시 닫아도 된다 ─── */
create or replace function public.semis_logi_desk_close(p_id bigint, p_status text, p_result text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.desk_me();
  if not found or c.rank < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(p_status, '') not in ('done', 'kept', 'back') then return jsonb_build_object('ok', false, 'error', 'status'); end if;
  update semis_logi_private.desk_inbox
     set status = p_status,
         result = case when p_status = 'done' then left(btrim(regexp_replace(coalesce(p_result, ''), '[[:cntrl:]]', '', 'g')), 200) else '' end,
         done_by = left(coalesce(c.name, ''), 60), done_at = now()
   where id = p_id and (status in ('new', 'taken') or status = p_status);
  if not found then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  perform semis_logi_private.desk_notify();
  return jsonb_build_object('ok', true);
end $$;

/* ─── 파일 함수 세션 확인 — role 을 더한다(desk-in 올리기는 내부 직원만) ─── */
create or replace function public.semis_logi_file_auth() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'rank', c.rank, 'role', coalesce(c.role, ''), 'who', coalesce(c.login_id, c.kind));
end $$;

revoke all on function public.semis_logi_desk_submit(jsonb), public.semis_logi_desk_mine(), public.semis_logi_desk_cancel(bigint),
  public.semis_logi_desk_inbox(), public.semis_logi_desk_take(bigint), public.semis_logi_desk_close(bigint, text, text),
  public.semis_logi_file_auth() from public, authenticated;
grant execute on function public.semis_logi_desk_submit(jsonb), public.semis_logi_desk_mine(), public.semis_logi_desk_cancel(bigint),
  public.semis_logi_desk_inbox(), public.semis_logi_desk_take(bigint), public.semis_logi_desk_close(bigint, text, text),
  public.semis_logi_file_auth() to anon, service_role;
revoke all on function semis_logi_private.desk_me(), semis_logi_private.desk_notify(),
  semis_logi_private.desk_mine_row(semis_logi_private.desk_inbox), semis_logi_private.desk_file_ok(text)
  from public, anon, authenticated;
