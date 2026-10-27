import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BlockAnchor,
  DuplicateReportError,
  EntryLocation,
  LedgerBlock,
  LedgerEntry,
  LedgerStore,
  SealConflictError,
  SealedHeader,
} from "./ledger";

/** pg의 Pool/Client와 PGlite가 모두 만족하는 최소 인터페이스 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const SQL_DIR = join(__dirname, "..", "sql");

/** sql/ 폴더의 마이그레이션 파일 목록. Supabase 전용 파일은 includeSupabase일 때만 포함한다. */
export function migrationFiles(includeSupabase: boolean): string[] {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql") && (includeSupabase || !f.includes("supabase")))
    .sort()
    .map((f) => join(SQL_DIR, f));
}

/** 여러 문장이 든 SQL 파일을 그대로 실행한다. (pg는 query, PGlite는 exec로 다중 문장을 실행) */
export async function applyMigrations(exec: (sql: string) => Promise<unknown>, includeSupabase: boolean) {
  for (const file of migrationFiles(includeSupabase)) {
    await exec(readFileSync(file, "utf8"));
  }
}

type BlockRow = {
  height: string | number | bigint;
  prev_hash: string;
  merkle_root: string;
  created_at_ms: string | number | bigint;
  entry_count: number;
  hash: string;
  anchor_network: string | null;
  anchor_tx_hash: string | null;
  anchored_at: Date | string | null;
};

type EntryRow = { report_id: string; report_hash: string; submitted_at: Date | string };

const BLOCK_COLUMNS = "height, prev_hash, merkle_root, created_at_ms, entry_count, hash, anchor_network, anchor_tx_hash, anchored_at";

const iso = (value: Date | string) => new Date(value).toISOString();

function toHeader(row: BlockRow): SealedHeader {
  const header: SealedHeader = {
    height: Number(row.height),
    prevHash: row.prev_hash,
    merkleRoot: row.merkle_root,
    createdAt: Number(row.created_at_ms),
    entryCount: Number(row.entry_count),
    hash: row.hash,
  };
  if (row.anchor_tx_hash && row.anchored_at) {
    header.anchor = { network: row.anchor_network ?? "", txHash: row.anchor_tx_hash, anchoredAt: iso(row.anchored_at) };
  }
  return header;
}

function toEntry(row: EntryRow): LedgerEntry {
  return { reportId: row.report_id, reportHash: row.report_hash, submittedAt: iso(row.submitted_at) };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Supabase(Postgres) 원장 저장소. 블록 확정은 ledger_append_block 함수 안에서 원자적으로 처리된다. */
export class PostgresStore implements LedgerStore {
  constructor(private readonly db: Queryable) {}

  async addPending(entry: LedgerEntry) {
    try {
      await this.db.query(
        "insert into ledger_entries (report_id, report_hash, submitted_at) values ($1, $2, $3)",
        [entry.reportId, entry.reportHash, entry.submittedAt],
      );
    } catch (error) {
      if (errorCode(error) === "23505") throw new DuplicateReportError(entry.reportId);
      throw error;
    }
  }

  async pending() {
    const { rows } = await this.db.query(
      "select report_id, report_hash, submitted_at from ledger_entries where block_height is null order by seq",
    );
    return rows.map(toEntry);
  }

  async head() {
    const { rows } = await this.db.query(`select ${BLOCK_COLUMNS} from ledger_blocks order by height desc limit 1`);
    return rows[0] ? toHeader(rows[0]) : null;
  }

  async appendBlock(block: LedgerBlock) {
    try {
      await this.db.query("select ledger_append_block($1, $2, $3, $4, $5, $6)", [
        block.height,
        block.prevHash,
        block.merkleRoot,
        block.createdAt,
        block.hash,
        block.entries.map((e) => e.reportId),
      ]);
    } catch (error) {
      const message = errorMessage(error);
      // 같은 height를 다른 프로세스가 먼저 넣은 경우(23505)도 경합으로 본다.
      if (message.includes("SEAL_CONFLICT") || errorCode(error) === "23505") throw new SealConflictError(message);
      throw error;
    }
  }

  async block(height: number) {
    const { rows } = await this.db.query(`select ${BLOCK_COLUMNS} from ledger_blocks where height = $1`, [height]);
    if (!rows[0]) return null;
    const entries = await this.db.query(
      "select report_id, report_hash, submitted_at from ledger_entries where block_height = $1 order by leaf_index",
      [height],
    );
    return { ...toHeader(rows[0]), entries: entries.rows.map(toEntry) };
  }

  async blocks() {
    // 블록을 먼저 읽고 기록을 나중에 읽는다. 블록과 기록 배정은 한 트랜잭션에서 커밋되므로,
    // 이 순서면 읽은 블록의 기록은 반드시 보이고, 그 사이 새로 생긴 블록의 기록은 무시된다.
    const blocks = await this.db.query(`select ${BLOCK_COLUMNS} from ledger_blocks order by height`);
    const entries = await this.db.query(
      "select block_height, report_id, report_hash, submitted_at from ledger_entries where block_height is not null order by block_height, leaf_index",
    );
    const byHeight = new Map<number, LedgerEntry[]>();
    for (const row of entries.rows) {
      const height = Number(row.block_height);
      byHeight.set(height, [...(byHeight.get(height) ?? []), toEntry(row)]);
    }
    return blocks.rows.map((row: BlockRow): LedgerBlock => {
      const header = toHeader(row);
      return { ...header, entries: byHeight.get(header.height) ?? [] };
    });
  }

  async locate(reportId: string): Promise<EntryLocation | null> {
    const { rows } = await this.db.query("select block_height from ledger_entries where report_id = $1", [reportId]);
    if (!rows[0]) return null;
    return rows[0].block_height === null ? { status: "pending" } : { status: "sealed", height: Number(rows[0].block_height) };
  }

  async unanchored() {
    const { rows } = await this.db.query(`select ${BLOCK_COLUMNS} from ledger_blocks where anchor_tx_hash is null order by height`);
    return rows.map(toHeader);
  }

  async markAnchored(height: number, anchor: BlockAnchor) {
    const { rows } = await this.db.query(
      `update ledger_blocks set anchor_network = $2, anchor_tx_hash = $3, anchored_at = $4
        where height = $1 and anchor_tx_hash is null returning height`,
      [height, anchor.network, anchor.txHash, anchor.anchoredAt],
    );
    if (!rows[0]) throw new Error(`블록 #${height}이 없거나 앵커 정보가 이미 기록되어 있습니다.`);
  }
}
