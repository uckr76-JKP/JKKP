-- Supabase 전용. Supabase는 public 스키마의 새 함수·테이블에 anon/authenticated 권한을 기본 부여하므로 명시적으로 회수한다.
-- (Supabase가 아닌 Postgres에는 anon/authenticated 역할이 없으므로 적용하지 않는다.)

revoke all on table ledger_blocks, ledger_entries from anon, authenticated;
revoke all on function ledger_append_block(bigint, text, text, bigint, text, text[]) from anon, authenticated;
revoke all on function ledger_guard() from anon, authenticated;
