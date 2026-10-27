-- VB-LEDGER-v1: 정산 리포트 경량 해시체인 원장
-- 해시·Merkle 계산은 애플리케이션(lib/ledger.ts)에서 하고, DB는 순서·원자성·추가 전용(append-only)을 보장한다.

create table if not exists ledger_blocks (
  height         bigint primary key check (height >= 0),
  prev_hash      text   not null check (prev_hash   ~ '^0x[0-9a-f]{64}$'),
  merkle_root    text   not null check (merkle_root ~ '^0x[0-9a-f]{64}$'),
  created_at_ms  bigint not null,
  entry_count    int    not null check (entry_count > 0),
  hash           text   not null unique check (hash ~ '^0x[0-9a-f]{64}$'),
  anchor_network text,
  anchor_tx_hash text,
  anchored_at    timestamptz,
  check ((anchor_tx_hash is null) = (anchored_at is null))
);

create table if not exists ledger_entries (
  seq          bigint generated always as identity primary key,
  report_id    text not null unique check (length(btrim(report_id)) > 0),
  report_hash  text not null check (report_hash ~ '^0x[0-9a-f]{64}$'),
  submitted_at timestamptz not null,
  block_height bigint references ledger_blocks (height),
  leaf_index   int,
  check ((block_height is null) = (leaf_index is null)),
  unique (block_height, leaf_index)
);

create index if not exists ledger_entries_pending_idx on ledger_entries (seq) where block_height is null;

-- 추가 전용 보호: 삭제 금지, 기록 내용 수정 금지.
-- 허용되는 변경은 (1) 대기 기록을 블록에 배정, (2) 블록에 앵커 정보를 한 번 기록 뿐이다.
create or replace function ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'LEDGER_APPEND_ONLY: % 삭제 불가', tg_table_name;
  end if;

  if tg_table_name = 'ledger_entries' then
    if (new.report_id, new.report_hash, new.submitted_at) is distinct from (old.report_id, old.report_hash, old.submitted_at)
       or (old.block_height is not null
           and (new.block_height, new.leaf_index) is distinct from (old.block_height, old.leaf_index)) then
      raise exception 'LEDGER_APPEND_ONLY: 기록 % 수정 불가', old.report_id;
    end if;
  else
    if (new.height, new.prev_hash, new.merkle_root, new.created_at_ms, new.entry_count, new.hash)
       is distinct from (old.height, old.prev_hash, old.merkle_root, old.created_at_ms, old.entry_count, old.hash) then
      raise exception 'LEDGER_APPEND_ONLY: 블록 #% 헤더 수정 불가', old.height;
    end if;
    if old.anchor_tx_hash is not null then
      raise exception 'LEDGER_APPEND_ONLY: 블록 #% 앵커 정보는 이미 기록됨', old.height;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ledger_entries_guard on ledger_entries;
create trigger ledger_entries_guard before update or delete on ledger_entries
  for each row execute function ledger_guard();

drop trigger if exists ledger_blocks_guard on ledger_blocks;
create trigger ledger_blocks_guard before update or delete on ledger_blocks
  for each row execute function ledger_guard();

-- 블록 확정. 동시에 여러 서버가 호출해도 head 위에 정확히 한 블록만 붙는다.
-- p_report_ids의 순서가 곧 Merkle 리프 순서(leaf_index)다.
create or replace function ledger_append_block(
  p_height        bigint,
  p_prev_hash     text,
  p_merkle_root   text,
  p_created_at_ms bigint,
  p_hash          text,
  p_report_ids    text[]
) returns void language plpgsql as $$
declare
  v_head    ledger_blocks%rowtype;
  v_updated int;
begin
  perform pg_advisory_xact_lock(hashtext('vb_ledger_append_block'));

  select * into v_head from ledger_blocks order by height desc limit 1;
  if not found then
    if p_height <> 0 or p_prev_hash <> '0x' || repeat('0', 64) then
      raise exception 'SEAL_CONFLICT: 제네시스 블록 조건 불일치';
    end if;
  elsif p_height <> v_head.height + 1 or p_prev_hash <> v_head.hash then
    raise exception 'SEAL_CONFLICT: head가 #%로 바뀜', v_head.height;
  elsif p_created_at_ms < v_head.created_at_ms then
    raise exception 'SEAL_CONFLICT: 생성 시각이 이전 블록보다 앞섬';
  end if;

  if coalesce(cardinality(p_report_ids), 0) = 0 then
    raise exception 'SEAL_CONFLICT: 빈 블록';
  end if;

  insert into ledger_blocks (height, prev_hash, merkle_root, created_at_ms, entry_count, hash)
  values (p_height, p_prev_hash, p_merkle_root, p_created_at_ms, cardinality(p_report_ids), p_hash);

  update ledger_entries e
     set block_height = p_height, leaf_index = t.ord - 1
    from unnest(p_report_ids) with ordinality as t (report_id, ord)
   where e.report_id = t.report_id and e.block_height is null;

  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_report_ids) then
    raise exception 'SEAL_CONFLICT: 대기 상태가 아닌 기록 포함 (% / %)', v_updated, cardinality(p_report_ids);
  end if;
end $$;

revoke all on function ledger_append_block(bigint, text, text, bigint, text, text[]) from public;

-- Supabase: 브라우저용 anon/authenticated 키로는 접근하지 못하게 RLS만 켜고 정책은 두지 않는다.
-- 원장은 서버(직접 DB 연결)에서만 다룬다.
alter table ledger_blocks enable row level security;
alter table ledger_entries enable row level security;
