/* ═══════════════════════════════════════════════════════
   H:drive — 게시판(공지사항 · 일반게시판 · 자료실 …)
   - 게시판 정의(이름 · 권한 · 기능 토글)는 공용 행 semis_logi_store 'boards'(읽기 1 · 쓰기 4 = 시스템관리자).
   - 글 · 댓글 · 열람 기록은 비공개 표에만 두고 RPC 로만 읽고 쓴다(서버가 게시판 권한 · 작성자 확인 · 쪽 나누기 · 검색).
   - 등급: all 1 · mgr 2 · hq 3 · admin 4. 협력업체 · 서명 세션은 게시판을 쓰지 않는다.
   - 남의 글 수정 · 삭제 · 상단 고정 · 이동은 안전보안파트(hq) 이상. 삭제는 표시만(90일 뒤 정리) — 시스템관리자가 되살린다.
   - 실제 적용은 마이그레이션 semis_logi_security_28_bbs*(한 번에 넣을 수 있는 크기 제한으로 나눠 적용). 이 파일은 참고용 사본이다.
   ═══════════════════════════════════════════════════════ */

create table if not exists semis_logi_private.bbs_posts (
  id          bigserial primary key,
  board       text not null,
  no          int not null,                         -- 게시판 안 글 번호(1부터, 지워도 다시 쓰지 않음)
  thread      bigint,                               -- 원글 id(답글 묶음 · 정렬)
  path        text not null default '',             -- 답글 순서 '001.002.'
  depth       int not null default 0,
  parent      bigint,
  cat         text not null default '',
  title       text not null,
  body        text not null default '',             -- 검색용 글(서식 없음)
  html        text not null default '',             -- 서식 본문 — 화면이 살균해서 그린다
  files       jsonb not null default '[]'::jsonb,   -- [{ name, url, size, type }]
  pinned      boolean not null default false,
  pin_until   date,
  author_id   text,
  author_name text not null default '',
  views       int not null default 0,
  ncomments   int not null default 0,
  src         text,                                  -- 이관 · 아르고 등 출처
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists bbs_posts_board_no on semis_logi_private.bbs_posts(board, no);
create index if not exists bbs_posts_board_order on semis_logi_private.bbs_posts(board, thread desc, path);
create index if not exists bbs_posts_created on semis_logi_private.bbs_posts(created_at desc);
create table if not exists semis_logi_private.bbs_comments (
  id          bigserial primary key,
  post        bigint not null references semis_logi_private.bbs_posts(id) on delete cascade,
  body        text not null,
  author_id   text,
  author_name text not null default '',
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists bbs_comments_post on semis_logi_private.bbs_comments(post, id);
create table if not exists semis_logi_private.bbs_reads (
  post       bigint not null references semis_logi_private.bbs_posts(id) on delete cascade,
  account_id text not null,
  at         timestamptz not null default now(),
  primary key (post, account_id)
);
alter table semis_logi_private.bbs_posts    enable row level security;
alter table semis_logi_private.bbs_comments enable row level security;
alter table semis_logi_private.bbs_reads    enable row level security;
revoke all on semis_logi_private.bbs_posts, semis_logi_private.bbs_comments, semis_logi_private.bbs_reads from public, anon, authenticated;

insert into semis_logi_private.key_acl(key, read_rank, write_rank) values ('boards', 1, 4)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank;

/* ─── 도우미 ─── */
create or replace function semis_logi_private.bbs_rank(p text) returns int
language sql immutable set search_path = '' as $$
  select case p when 'all' then 1 when 'mgr' then 2 when 'hq' then 3 when 'admin' then 4 else 3 end
$$;
create or replace function semis_logi_private.bbs_int(p text, p_def bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9]{1,15}$' then p::bigint else p_def end
$$;
create or replace function semis_logi_private.bbs_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;
/* 내부 계정 세션만(협력업체 · 서명 제외) */
create or replace function semis_logi_private.bbs_me() returns table(account_id text, name text, role text, rank int)
language sql stable security definer set search_path = '' as $$
  select c.account_id, coalesce(nullif(c.name, ''), c.login_id), c.role, c.rank
    from semis_logi_private.ctx() c
   where c.kind = 'user' and c.account_id is not null and c.role in ('admin', 'hq', 'manager', 'user')
   limit 1
$$;
create or replace function semis_logi_private.bbs_boards() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select b from public.semis_logi_store s,
         jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) b
   where s.key = 'boards' and jsonb_typeof(b) = 'object' and coalesce(b ->> 'id', '') ~ '^B[0-9]{3}$'
$$;
create or replace function semis_logi_private.bbs_board(p_b text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select b from semis_logi_private.bbs_boards() b where b ->> 'id' = p_b limit 1
$$;
create or replace function semis_logi_private.bbs_on(b jsonb, k text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(b #>> array['opt', k], '') = 'true'
$$;
/* 검색어 — 띄어쓰기로 나눈 낱말이 모두 들어 있어야 한다(%, _ 는 글자 그대로) */
create or replace function semis_logi_private.bbs_like(p_hay text, p_terms text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(coalesce(p_hay, '') ilike '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%'), true)
    from unnest(p_terms) t
$$;
create or replace function semis_logi_private.bbs_terms(p text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(t), '{}') from (
    select t from regexp_split_to_table(left(btrim(coalesce(p, '')), 100), '\s+') t where t <> '' limit 5) x
$$;
/* 첨부 — 이 저장소 표준 주소만(게시판 폴더 · 옛 공지 폴더) */
create or replace function semis_logi_private.bbs_files(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', left(coalesce(f ->> 'name', '첨부'), 200),
           'url', f ->> 'url',
           'size', case when coalesce(f ->> 'size', '') ~ '^[0-9]{1,12}$' then (f ->> 'size')::bigint else 0 end,
           'type', left(coalesce(f ->> 'type', ''), 100)) order by o), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as x(f, o)
   where o <= 30 and jsonb_typeof(f) = 'object'
     and coalesce(f ->> 'url', '') ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/semis-logi-files/(bbs[1-4]|attach|notices)/[A-Za-z0-9._-]{1,200}$'
$$;
/* 열린 게시판 화면에 변경 알림(게시판 id 만) — 실패해도 저장은 그대로 */
create or replace function semis_logi_private.bbs_notify(p_b text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('key', 'bbs:' || p_b, 'by', '', 'at', now()), 'change', 'semis-logi-sync', false);
exception when others then
  null;
end $$;
create or replace function semis_logi_private.bbs_row(x semis_logi_private.bbs_posts, p_me text, p_new int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'no', x.no, 'b', x.board, 'cat', x.cat, 'title', x.title, 'by', x.author_name,
    'at', x.created_at, 'up', x.updated_at, 'views', x.views, 'nc', x.ncomments, 'nf', jsonb_array_length(x.files),
    'depth', x.depth, 'f1', x.files -> 0, 'pin', x.pinned and (x.pin_until is null or x.pin_until >= semis_logi_private.bbs_today()),
    'mine', x.author_id is not distinct from p_me,
    'fresh', x.created_at > now() - make_interval(days => greatest(0, least(p_new, 30))),
    'read', x.author_id is not distinct from p_me or exists (select 1 from semis_logi_private.bbs_reads r where r.post = x.id and r.account_id = p_me),
    'img', coalesce((select f ->> 'url' from jsonb_array_elements(x.files) f where coalesce(f ->> 'type', '') like 'image/%' limit 1),
                    substring(x.html from '<img[^>]+src="(https://[^"]+)"')))
$$;
create or replace function semis_logi_private.bbs_newdays(b jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when coalesce(b #>> '{opt,newDays}', '') ~ '^[0-9]{1,2}$' then least((b #>> '{opt,newDays}')::int, 30) else 3 end
$$;

/* ─── 목록 ─── p { b, page, size, q, f(all|title|body|author), cat } */
create or replace function public.semis_logi_bbs_list(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c record; b jsonb; v_b text := left(coalesce(p ->> 'b', ''), 8);
  v_page int; v_size int; v_terms text[]; v_f text := coalesce(p ->> 'f', 'all'); v_cat text := left(coalesce(p ->> 'cat', ''), 40);
  v_total int; v_rows jsonb; v_pins jsonb; v_new int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  b := semis_logi_private.bbs_board(v_b);
  if b is null then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  if c.rank < semis_logi_private.bbs_rank(b ->> 'read') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_new := semis_logi_private.bbs_newdays(b);
  v_size := semis_logi_private.bbs_int(p ->> 'size', semis_logi_private.bbs_int(b ->> 'perPage', 20));
  if v_size not in (10, 15, 20, 30, 50, 100) then v_size := 20; end if;
  v_page := greatest(1, least(semis_logi_private.bbs_int(p ->> 'page', 1), 100000));
  v_terms := semis_logi_private.bbs_terms(p ->> 'q');
  if v_f not in ('all', 'title', 'body', 'author') then v_f := 'all'; end if;

  select count(*) into v_total from semis_logi_private.bbs_posts x
   where x.board = v_b and x.deleted_at is null and (v_cat = '' or x.cat = v_cat)
     and semis_logi_private.bbs_like(case v_f when 'title' then x.title when 'body' then x.body when 'author' then x.author_name
                                      else x.title || ' ' || x.body || ' ' || x.author_name end, v_terms);
  if (v_page - 1) * v_size >= v_total and v_total > 0 then v_page := ((v_total - 1) / v_size) + 1; end if;

  select coalesce(jsonb_agg(semis_logi_private.bbs_row(x, c.account_id, v_new) order by x.thread desc, x.path), '[]'::jsonb) into v_rows
    from semis_logi_private.bbs_posts x
    join (select k.id from semis_logi_private.bbs_posts k
           where k.board = v_b and k.deleted_at is null and (v_cat = '' or k.cat = v_cat)
             and semis_logi_private.bbs_like(case v_f when 'title' then k.title when 'body' then k.body when 'author' then k.author_name
                                              else k.title || ' ' || k.body || ' ' || k.author_name end, v_terms)
           order by k.thread desc, k.path
           offset (v_page - 1) * v_size limit v_size) pg on pg.id = x.id;

  v_pins := '[]'::jsonb;
  if semis_logi_private.bbs_on(b, 'pin') and v_page = 1 and cardinality(v_terms) = 0 and v_cat = '' then
    select coalesce(jsonb_agg(semis_logi_private.bbs_row(x, c.account_id, v_new) order by x.created_at desc), '[]'::jsonb) into v_pins
      from semis_logi_private.bbs_posts x
      join (select k.id from semis_logi_private.bbs_posts k
             where k.board = v_b and k.deleted_at is null and k.pinned
               and (k.pin_until is null or k.pin_until >= semis_logi_private.bbs_today())
             order by k.created_at desc limit 10) pg on pg.id = x.id;
  end if;
  return jsonb_build_object('ok', true, 'total', v_total, 'page', v_page, 'size', v_size, 'rows', v_rows, 'pins', v_pins,
    'rank', c.rank, 'me', c.account_id);
end $$;

/* ─── 읽기 — 처음 여는 계정이면 열람 기록 · 조회 +1 ─── */
create or replace function public.semis_logi_bbs_get(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; x semis_logi_private.bbs_posts%rowtype; b jsonb; v_read int; v_mng boolean; v_mine boolean; v_first boolean := false;
  v_cm jsonb := '[]'::jsonb; v_rd jsonb := null; v_prev jsonb; v_next jsonb; v_kids int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select * into x from semis_logi_private.bbs_posts where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  b := semis_logi_private.bbs_board(x.board);
  if b is null then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  v_read := semis_logi_private.bbs_rank(b ->> 'read');
  if c.rank < v_read then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_mng := c.rank >= 3;
  v_mine := x.author_id is not distinct from c.account_id;

  insert into semis_logi_private.bbs_reads(post, account_id) values (x.id, c.account_id) on conflict do nothing;
  get diagnostics v_kids = row_count;
  if v_kids > 0 then
    v_first := true;
    update semis_logi_private.bbs_posts set views = views + 1 where id = x.id returning views into x.views;
  end if;

  if semis_logi_private.bbs_on(b, 'comment') then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'by', m.author_name, 'at', m.created_at,
             'mine', m.author_id is not distinct from c.account_id) order by m.id), '[]'::jsonb) into v_cm
      from semis_logi_private.bbs_comments m where m.post = x.id and m.deleted_at is null;
  end if;
  if semis_logi_private.bbs_on(b, 'readers') and (v_mng or v_mine) then
    select jsonb_build_object(
      'read', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'at', r.at) order by r.at)
                          from semis_logi_private.bbs_reads r join semis_logi_private.accounts a on a.id = r.account_id
                         where r.post = x.id and r.account_id is distinct from x.author_id), '[]'::jsonb),
      'unread', coalesce((select jsonb_agg(a.name order by a.name) from semis_logi_private.accounts a
                           where not a.disabled and a.role in ('admin', 'hq', 'manager', 'user')
                             and semis_logi_private.rank_of(a.role) >= v_read
                             and a.id is distinct from x.author_id
                             and not exists (select 1 from semis_logi_private.bbs_reads r where r.post = x.id and r.account_id = a.id)), '[]'::jsonb))
      into v_rd;
  end if;
  select jsonb_build_object('id', y.id, 'title', y.title) into v_prev from semis_logi_private.bbs_posts y
   where y.board = x.board and y.deleted_at is null and y.depth = 0 and y.id < x.thread order by y.id desc limit 1;
  select jsonb_build_object('id', y.id, 'title', y.title) into v_next from semis_logi_private.bbs_posts y
   where y.board = x.board and y.deleted_at is null and y.depth = 0 and y.id > x.thread order by y.id limit 1;
  select count(*) into v_kids from semis_logi_private.bbs_posts y
   where y.thread = x.thread and y.deleted_at is null and y.depth > x.depth and y.path like x.path || '%' and y.id <> x.id;

  return jsonb_build_object('ok', true, 'first', v_first,
    'post', jsonb_build_object('id', x.id, 'no', x.no, 'b', x.board, 'cat', x.cat, 'title', x.title, 'html', x.html, 'body', x.body,
      'files', x.files, 'by', x.author_name, 'at', x.created_at, 'up', x.updated_at, 'views', x.views,
      'pin', x.pinned, 'pinUntil', x.pin_until, 'depth', x.depth, 'parent', x.parent, 'mine', v_mine, 'replies', v_kids),
    'comments', v_cm, 'readers', v_rd, 'prev', v_prev, 'next', v_next,
    'can', jsonb_build_object(
      'edit', v_mine or v_mng,
      'del', v_mng or (v_mine and not exists (select 1 from semis_logi_private.bbs_posts y where y.thread = x.thread and y.deleted_at is null
                                                and y.depth > x.depth and y.path like x.path || '%' and y.author_id is distinct from c.account_id)),
      'reply', semis_logi_private.bbs_on(b, 'reply') and x.depth < 3 and c.rank >= semis_logi_private.bbs_rank(b ->> 'write'),
      'comment', semis_logi_private.bbs_on(b, 'comment') and c.rank >= semis_logi_private.bbs_rank(coalesce(b ->> 'cmt', b ->> 'read')),
      'manage', v_mng));
end $$;

/* ─── 쓰기 · 고치기 ─── p { id?, b, title, html, body, files, cat, pin, pinUntil, parent } */
create or replace function public.semis_logi_bbs_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; b jsonb; x semis_logi_private.bbs_posts%rowtype; par semis_logi_private.bbs_posts%rowtype;
  v_id bigint := semis_logi_private.bbs_int(p ->> 'id', 0); v_b text := left(coalesce(p ->> 'b', ''), 8);
  v_title text := left(btrim(regexp_replace(coalesce(p ->> 'title', ''), '[\r\n\t]+', ' ', 'g')), 200);
  v_html text := left(coalesce(p ->> 'html', ''), 300000); v_body text := left(coalesce(p ->> 'body', ''), 100000);
  v_files jsonb := semis_logi_private.bbs_files(p -> 'files');
  v_cat text := left(btrim(coalesce(p ->> 'cat', '')), 40);
  v_pin boolean := coalesce(p ->> 'pin', '') = 'true'; v_until date := null;
  v_par bigint := semis_logi_private.bbs_int(p ->> 'parent', 0); v_no int; v_n int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if v_title = '' then return jsonb_build_object('ok', false, 'error', 'title'); end if;
  if coalesce(p ->> 'pinUntil', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin v_until := (p ->> 'pinUntil')::date; exception when others then v_until := null; end;
  end if;

  if v_id > 0 then
    select * into x from semis_logi_private.bbs_posts where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
    v_b := x.board;
  end if;
  b := semis_logi_private.bbs_board(v_b);
  if b is null then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  if c.rank < semis_logi_private.bbs_rank(b ->> 'read') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not semis_logi_private.bbs_on(b, 'attach') then v_files := '[]'::jsonb; end if;
  if not semis_logi_private.bbs_on(b, 'cat') or not exists (
       select 1 from jsonb_array_elements_text(case when jsonb_typeof(b -> 'cats') = 'array' then b -> 'cats' else '[]'::jsonb end) k where k = v_cat) then
    v_cat := '';
  end if;
  if not (semis_logi_private.bbs_on(b, 'pin') and c.rank >= 3) then
    v_pin := case when v_id > 0 then x.pinned else false end;
    v_until := case when v_id > 0 then x.pin_until else null end;
  end if;
  if not v_pin then v_until := null; end if;

  if v_id > 0 then
    if not (x.author_id is not distinct from c.account_id or c.rank >= 3) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
    update semis_logi_private.bbs_posts
       set title = v_title, html = v_html, body = v_body, files = v_files, cat = v_cat, pinned = v_pin, pin_until = v_until,
           updated_at = now(), updated_by = c.name
     where id = v_id;
    perform semis_logi_private.bbs_notify(v_b);
    return jsonb_build_object('ok', true, 'id', v_id, 'no', x.no, 'b', v_b);
  end if;

  if c.rank < semis_logi_private.bbs_rank(b ->> 'write') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select count(*) into v_n from semis_logi_private.bbs_posts
   where author_id = c.account_id and created_at > now() - interval '1 minute';
  if v_n >= 10 then return jsonb_build_object('ok', false, 'error', 'rate'); end if;
  if v_par > 0 then
    if not semis_logi_private.bbs_on(b, 'reply') then return jsonb_build_object('ok', false, 'error', 'reply'); end if;
    select * into par from semis_logi_private.bbs_posts where id = v_par and board = v_b and deleted_at is null;
    if not found or par.depth >= 3 then return jsonb_build_object('ok', false, 'error', 'reply'); end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('semis_logi_bbs:' || v_b));
  select coalesce(max(no), 0) + 1 into v_no from semis_logi_private.bbs_posts where board = v_b;
  insert into semis_logi_private.bbs_posts(board, no, title, html, body, files, cat, pinned, pin_until, author_id, author_name, updated_by,
                                           parent, depth, thread, path, src)
  values (v_b, v_no, v_title, v_html, v_body, v_files, v_cat, v_pin and v_par = 0, case when v_par = 0 then v_until end,
          c.account_id, c.name, c.name,
          case when v_par > 0 then par.id end, case when v_par > 0 then par.depth + 1 else 0 end,
          case when v_par > 0 then par.thread end,
          case when v_par > 0 then par.path || lpad(((select count(*) from semis_logi_private.bbs_posts y where y.parent = par.id) + 1)::text, 3, '0') || '.' else '' end,
          case when coalesce(p ->> 'src', '') = 'argo' then 'argo' end)
  returning id into v_id;
  if v_par = 0 then update semis_logi_private.bbs_posts set thread = v_id where id = v_id; end if;
  perform semis_logi_private.bbs_notify(v_b);
  return jsonb_build_object('ok', true, 'id', v_id, 'no', v_no, 'b', v_b);
end $$;

/* ─── 지우기 — p { ids: [..] }. 답글까지 함께. 남의 답글이 달린 글은 hq 이상만 ─── */
create or replace function public.semis_logi_bbs_delete(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; x semis_logi_private.bbs_posts%rowtype; b jsonb; v_id text; v_n int := 0; v_k int; v_boards text[] := '{}';
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  for v_id in select jsonb_array_elements_text(case when jsonb_typeof(p -> 'ids') = 'array' then p -> 'ids' else '[]'::jsonb end) limit 200 loop
    select * into x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(v_id, 0) and deleted_at is null;
    if not found then continue; end if;
    b := semis_logi_private.bbs_board(x.board);
    if b is not null and c.rank < semis_logi_private.bbs_rank(b ->> 'read') then continue; end if;
    if c.rank < 3 then
      if x.author_id is distinct from c.account_id then return jsonb_build_object('ok', false, 'error', 'forbidden', 'n', v_n); end if;
      if exists (select 1 from semis_logi_private.bbs_posts y where y.thread = x.thread and y.deleted_at is null and y.depth > x.depth
                   and y.path like x.path || '%' and y.author_id is distinct from c.account_id) then
        return jsonb_build_object('ok', false, 'error', 'replies', 'n', v_n);
      end if;
    end if;
    update semis_logi_private.bbs_posts y set deleted_at = now(), deleted_by = c.name
     where y.deleted_at is null and (y.id = x.id or (y.thread = x.thread and y.depth > x.depth and y.path like x.path || '%'));
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
    v_boards := array_append(v_boards, x.board);
  end loop;
  delete from semis_logi_private.bbs_posts where deleted_at < now() - interval '90 days';
  perform semis_logi_private.bbs_notify(t) from (select distinct unnest(v_boards) t) z;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

/* ─── 댓글 — p { post, body } 쓰기 / p { del } 지우기(본인 · hq 이상) ─── */
create or replace function public.semis_logi_bbs_comment(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; x semis_logi_private.bbs_posts%rowtype; b jsonb; m semis_logi_private.bbs_comments%rowtype;
  v_body text := left(btrim(coalesce(p ->> 'body', '')), 2000); v_id bigint; v_n int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if semis_logi_private.bbs_int(p ->> 'del', 0) > 0 then
    select * into m from semis_logi_private.bbs_comments where id = semis_logi_private.bbs_int(p ->> 'del', 0) and deleted_at is null;
    if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
    if not (m.author_id is not distinct from c.account_id or c.rank >= 3) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
    select * into x from semis_logi_private.bbs_posts where id = m.post;
    b := semis_logi_private.bbs_board(x.board);
    if b is null or c.rank < semis_logi_private.bbs_rank(b ->> 'read') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
    update semis_logi_private.bbs_comments set deleted_at = now() where id = m.id;
    update semis_logi_private.bbs_posts set ncomments = greatest(0, ncomments - 1) where id = m.post;
    perform semis_logi_private.bbs_notify(x.board);
    return jsonb_build_object('ok', true);
  end if;
  select * into x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(p ->> 'post', 0) and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  b := semis_logi_private.bbs_board(x.board);
  if b is null or not semis_logi_private.bbs_on(b, 'comment') then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  if c.rank < semis_logi_private.bbs_rank(b ->> 'read') or c.rank < semis_logi_private.bbs_rank(coalesce(b ->> 'cmt', b ->> 'read')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_body = '' then return jsonb_build_object('ok', false, 'error', 'body'); end if;
  select count(*) into v_n from semis_logi_private.bbs_comments where author_id = c.account_id and created_at > now() - interval '1 minute';
  if v_n >= 20 then return jsonb_build_object('ok', false, 'error', 'rate'); end if;
  insert into semis_logi_private.bbs_comments(post, body, author_id, author_name) values (x.id, v_body, c.account_id, c.name) returning id into v_id;
  update semis_logi_private.bbs_posts set ncomments = ncomments + 1 where id = x.id;
  perform semis_logi_private.bbs_notify(x.board);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

/* ─── 메뉴 배지 · 통합 검색 색인 — 읽을 수 있는 게시판의 글 수 · 새 글 · 안 읽은 새 글 + 최근 글 제목 300건 ─── */
create or replace function public.semis_logi_bbs_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record; v_out jsonb := '{}'::jsonb; v_idx jsonb; r record;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  for r in select b ->> 'id' as id, semis_logi_private.bbs_newdays(b) as nd from semis_logi_private.bbs_boards() b
            where c.rank >= semis_logi_private.bbs_rank(b ->> 'read') loop
    v_out := v_out || jsonb_build_object(r.id, (
      select jsonb_build_object('total', count(*),
               'fresh', count(*) filter (where x.created_at > now() - make_interval(days => r.nd)),
               'unread', count(*) filter (where x.created_at > now() - make_interval(days => r.nd)
                                            and x.author_id is distinct from c.account_id
                                            and not exists (select 1 from semis_logi_private.bbs_reads d where d.post = x.id and d.account_id = c.account_id)))
        from semis_logi_private.bbs_posts x where x.board = r.id and x.deleted_at is null));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'b', x.board, 'no', x.no, 'title', x.title, 'by', x.author_name, 'at', x.created_at, 'cat', x.cat)
                            order by x.created_at desc), '[]'::jsonb) into v_idx
    from (select x.* from semis_logi_private.bbs_posts x
           where x.deleted_at is null and x.board in (select b ->> 'id' from semis_logi_private.bbs_boards() b
                                                       where c.rank >= semis_logi_private.bbs_rank(b ->> 'read'))
           order by x.created_at desc limit 300) x;
  return jsonb_build_object('ok', true, 'boards', v_out, 'index', v_idx);
end $$;

/* ─── 대시보드 · 아르고 — 최근 글. p { b: [게시판 id..] (없으면 '대시보드 표시' 켠 게시판), n } ─── */
create or replace function public.semis_logi_bbs_recent(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record; v_n int; v_ids text[]; v_rows jsonb;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  v_n := greatest(1, least(semis_logi_private.bbs_int(p ->> 'n', 6), 30));
  select coalesce(array_agg(b ->> 'id'), '{}') into v_ids from semis_logi_private.bbs_boards() b
   where c.rank >= semis_logi_private.bbs_rank(b ->> 'read')
     and (case when jsonb_typeof(p -> 'b') = 'array' then (b ->> 'id') in (select jsonb_array_elements_text(p -> 'b'))
               else semis_logi_private.bbs_on(b, 'dash') end);
  select coalesce(jsonb_agg(semis_logi_private.bbs_row(x, c.account_id, 3) order by (x.pinned and (x.pin_until is null or x.pin_until >= semis_logi_private.bbs_today())) desc, x.created_at desc), '[]'::jsonb)
    into v_rows
    from semis_logi_private.bbs_posts x
    join (select k.id from semis_logi_private.bbs_posts k where k.board = any(v_ids) and k.deleted_at is null and k.depth = 0
           order by (k.pinned and (k.pin_until is null or k.pin_until >= semis_logi_private.bbs_today())) desc, k.created_at desc limit v_n) pg on pg.id = x.id;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'boards', to_jsonb(v_ids));
end $$;

/* ─── 다른 게시판으로 옮기기(hq 이상, 답글까지) — p { ids, to } ─── */
create or replace function public.semis_logi_bbs_move(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; bt jsonb; x semis_logi_private.bbs_posts%rowtype; v_to text := left(coalesce(p ->> 'to', ''), 8); v_id text; v_no int; v_n int := 0;
  y record; v_from text[] := '{}';
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if c.rank < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  bt := semis_logi_private.bbs_board(v_to);
  if bt is null or c.rank < semis_logi_private.bbs_rank(bt ->> 'read') then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  perform pg_advisory_xact_lock(hashtext('semis_logi_bbs:' || v_to));
  for v_id in select jsonb_array_elements_text(case when jsonb_typeof(p -> 'ids') = 'array' then p -> 'ids' else '[]'::jsonb end) limit 200 loop
    select * into x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(v_id, 0) and deleted_at is null and depth = 0 and board <> v_to;
    if not found then continue; end if;
    if semis_logi_private.bbs_board(x.board) is not null and c.rank < semis_logi_private.bbs_rank(semis_logi_private.bbs_board(x.board) ->> 'read') then continue; end if;
    v_from := array_append(v_from, x.board);
    for y in select id from semis_logi_private.bbs_posts where thread = x.thread order by path loop
      select coalesce(max(no), 0) + 1 into v_no from semis_logi_private.bbs_posts where board = v_to;
      update semis_logi_private.bbs_posts set board = v_to, no = v_no, cat = case when semis_logi_private.bbs_on(bt, 'cat') then cat else '' end,
             updated_at = now(), updated_by = c.name where id = y.id;
      v_n := v_n + 1;
    end loop;
  end loop;
  perform semis_logi_private.bbs_notify(v_to);
  perform semis_logi_private.bbs_notify(t) from (select distinct unnest(v_from) t) z;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

/* ─── 시스템관리자 — counts(게시판별 글 수 · 지운 글) · trash · restore · drop · files ─── */
create or replace function public.semis_logi_bbs_admin(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; v_op text := coalesce(p ->> 'op', ''); v_b text := left(coalesce(p ->> 'b', ''), 8); v_n int; v_x semis_logi_private.bbs_posts%rowtype;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if c.rank < 4 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_op = 'counts' then
    return jsonb_build_object('ok', true, 'boards', coalesce((select jsonb_object_agg(board, jsonb_build_object('total', t, 'deleted', d, 'last', l))
      from (select board, count(*) filter (where deleted_at is null) t, count(*) filter (where deleted_at is not null) d,
                   max(created_at) filter (where deleted_at is null) l
              from semis_logi_private.bbs_posts group by board) z), '{}'::jsonb));
  elsif v_op = 'trash' then
    return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'b', x.board, 'no', x.no, 'title', x.title,
             'by', x.author_name, 'at', x.created_at, 'del', x.deleted_at, 'delBy', x.deleted_by, 'depth', x.depth) order by x.deleted_at desc)
      from (select * from semis_logi_private.bbs_posts x where x.deleted_at is not null and (v_b = '' or x.board = v_b)
             order by x.deleted_at desc limit 300) x), '[]'::jsonb));
  elsif v_op = 'restore' then
    select * into v_x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(p ->> 'id', 0) and deleted_at is not null;
    if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
    update semis_logi_private.bbs_posts y set deleted_at = null, deleted_by = null
     where y.deleted_at = v_x.deleted_at and (y.id = v_x.id or (y.thread = v_x.thread and y.depth > v_x.depth and y.path like v_x.path || '%'));
    get diagnostics v_n = row_count;
    perform semis_logi_private.bbs_notify(v_x.board);
    return jsonb_build_object('ok', true, 'n', v_n, 'b', v_x.board);
  elsif v_op = 'drop' then
    if v_b = '' or coalesce(p ->> 'confirm', '') <> v_b then return jsonb_build_object('ok', false, 'error', 'confirm'); end if;
    delete from semis_logi_private.bbs_posts where board = v_b;
    get diagnostics v_n = row_count;
    perform semis_logi_private.bbs_notify(v_b);
    return jsonb_build_object('ok', true, 'n', v_n);
  elsif v_op = 'files' then
    return jsonb_build_object('ok', true, 'urls', coalesce((select jsonb_agg(distinct u) from (
        select f ->> 'url' as u from semis_logi_private.bbs_posts x, jsonb_array_elements(x.files) f
        union all
        select m[1] from semis_logi_private.bbs_posts x, regexp_matches(x.html, 'src="(https://[^"]+)"', 'g') m) z where u is not null), '[]'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'op');
end $$;

revoke all on function public.semis_logi_bbs_list(jsonb), public.semis_logi_bbs_get(bigint), public.semis_logi_bbs_save(jsonb),
  public.semis_logi_bbs_delete(jsonb), public.semis_logi_bbs_comment(jsonb), public.semis_logi_bbs_stats(), public.semis_logi_bbs_recent(jsonb),
  public.semis_logi_bbs_move(jsonb), public.semis_logi_bbs_admin(jsonb) from public, authenticated;
grant execute on function public.semis_logi_bbs_list(jsonb), public.semis_logi_bbs_get(bigint), public.semis_logi_bbs_save(jsonb),
  public.semis_logi_bbs_delete(jsonb), public.semis_logi_bbs_comment(jsonb), public.semis_logi_bbs_stats(), public.semis_logi_bbs_recent(jsonb),
  public.semis_logi_bbs_move(jsonb), public.semis_logi_bbs_admin(jsonb) to anon, service_role;
/* 도우미는 RPC 안에서만(다른 비공개 도우미와 같게) */
revoke all on function semis_logi_private.bbs_rank(text), semis_logi_private.bbs_int(text, bigint), semis_logi_private.bbs_today(),
  semis_logi_private.bbs_me(), semis_logi_private.bbs_boards(), semis_logi_private.bbs_board(text), semis_logi_private.bbs_on(jsonb, text),
  semis_logi_private.bbs_like(text, text[]), semis_logi_private.bbs_terms(text), semis_logi_private.bbs_files(jsonb),
  semis_logi_private.bbs_notify(text), semis_logi_private.bbs_row(semis_logi_private.bbs_posts, text, int), semis_logi_private.bbs_newdays(jsonb)
  from public, anon, authenticated;

/* ─── 처음 한 번 — 기본 게시판 3개(공지사항 · 일반게시판 · 자료실) · 옛 공지 이관 ─── */
insert into public.semis_logi_store(key, value) values ('boards', '[
  {"id":"B001","name":"공지사항","kind":"notice","view":"list","desc":"","read":"all","write":"hq","cmt":"all","perPage":20,
   "opt":{"pin":true,"attach":true,"editor":true,"views":true,"readers":true,"comment":false,"reply":false,"cat":false,"dash":true,"newDays":7},"cats":[]},
  {"id":"B002","name":"일반게시판","kind":"general","view":"list","desc":"","read":"all","write":"all","cmt":"all","perPage":20,
   "opt":{"pin":true,"attach":true,"editor":true,"views":true,"readers":false,"comment":true,"reply":true,"cat":false,"dash":false,"newDays":3},"cats":[]},
  {"id":"B003","name":"자료실","kind":"archive","view":"file","desc":"","read":"all","write":"hq","cmt":"all","perPage":20,
   "opt":{"pin":true,"attach":true,"editor":true,"views":true,"readers":false,"comment":false,"reply":false,"cat":true,"dash":false,"newDays":7},
   "cats":["규정 · 지침","양식","교육 자료","기타"]}
]'::jsonb)
on conflict (key) do nothing;

insert into semis_logi_private.bbs_posts(board, no, title, body, html, files, pinned, author_name, created_at, updated_at, src)
select 'B001',
       coalesce((select max(no) from semis_logi_private.bbs_posts where board = 'B001'), 0) + row_number() over (order by coalesce(n ->> 'created', '')),
       left(coalesce(nullif(btrim(n ->> 'title'), ''), '(제목 없음)'), 200),
       left(coalesce(n ->> 'body', ''), 100000),
       left(coalesce(nullif(n ->> 'bodyHtml', ''),
                     replace(replace(replace(replace(coalesce(n ->> 'body', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>')), 300000),
       semis_logi_private.bbs_files(n -> 'files'),
       coalesce(n ->> 'pinned', '') = 'true',
       left(coalesce(n ->> 'author', ''), 60),
       case when coalesce(n ->> 'created', '') ~ '^\d{4}-\d{2}-\d{2}' then (n ->> 'created')::timestamptz else now() end,
       case when coalesce(n ->> 'created', '') ~ '^\d{4}-\d{2}-\d{2}' then (n ->> 'created')::timestamptz else now() end,
       'notice:' || (n ->> 'id')
  from public.semis_logi_store s, jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) n
 where s.key = 'notices' and jsonb_typeof(n) = 'object' and coalesce(n ->> 'id', '') <> ''
   and not exists (select 1 from semis_logi_private.bbs_posts x where x.src = 'notice:' || (n ->> 'id'));
update semis_logi_private.bbs_posts set thread = id where thread is null;
