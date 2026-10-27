import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MerkleStep, hexToBuf, leafHash, merkleProof, merkleRoot, rootFromProof, sha256, toHex } from "./merkle";
import { toReportKey } from "./proof";

export const LEDGER_VERSION = "VB-LEDGER-v1";
export const GENESIS_PREV_HASH = "0x" + "00".repeat(32);

export type LedgerEntry = { reportId: string; reportHash: string; submittedAt: string };

/** 블록 해시에 들어가는 필드. entries는 merkleRoot로, anchor는 해시 밖의 메타데이터로 다룬다. */
export type BlockHeader = {
  height: number;
  prevHash: string;
  merkleRoot: string;
  createdAt: number;
  entryCount: number;
};

export type BlockAnchor = { network: string; txHash: string; anchoredAt: string };

export type LedgerBlock = BlockHeader & { hash: string; entries: LedgerEntry[]; anchor?: BlockAnchor };

export type LedgerState = { version: string; blocks: LedgerBlock[]; pending: LedgerEntry[] };

/** 정산 당사자에게 리포트와 함께 전달하는 검증 영수증 */
export type Receipt = {
  version: string;
  reportId: string;
  reportHash: string;
  leafIndex: number;
  proof: MerkleStep[];
  block: BlockHeader & { hash: string };
  anchor?: BlockAnchor;
};

export type ReceiptCheck =
  | { ok: true }
  | { ok: false; reason: "HASH_MISMATCH" | "PROOF_INVALID" | "BLOCK_HASH_INVALID" | "VERSION_UNSUPPORTED" };

export function emptyState(): LedgerState {
  return { version: LEDGER_VERSION, blocks: [], pending: [] };
}

export function blockHash(header: BlockHeader): string {
  const buf = Buffer.alloc(8 + 32 + 32 + 8 + 4);
  buf.writeBigUInt64BE(BigInt(header.height), 0);
  hexToBuf(header.prevHash).copy(buf, 8);
  hexToBuf(header.merkleRoot).copy(buf, 40);
  buf.writeBigUInt64BE(BigInt(header.createdAt), 72);
  buf.writeUInt32BE(header.entryCount, 80);
  return toHex(sha256(Buffer.from(LEDGER_VERSION), buf));
}

export function entryLeaf(entry: Pick<LedgerEntry, "reportId" | "reportHash">): string {
  return leafHash(toReportKey(entry.reportId), entry.reportHash);
}

/** 공개 체인 컨트랙트에 블록 해시를 기록할 때 쓰는 키 */
export function blockAnchorKey(height: number): string {
  return toReportKey(`${LEDGER_VERSION}-BLOCK-${height}`);
}

function headerOf(block: LedgerBlock): BlockHeader {
  const { height, prevHash, merkleRoot, createdAt, entryCount } = block;
  return { height, prevHash, merkleRoot, createdAt, entryCount };
}

/** 원장 없이 리포트 파일 해시와 영수증만으로 대조한다. 공개 체인 대조는 별도로 한다. */
export function verifyReceipt(receipt: Receipt, fileHash: string): ReceiptCheck {
  if (receipt.version !== LEDGER_VERSION) return { ok: false, reason: "VERSION_UNSUPPORTED" };
  if (receipt.reportHash.toLowerCase() !== fileHash.toLowerCase()) return { ok: false, reason: "HASH_MISMATCH" };

  const root = rootFromProof(entryLeaf({ reportId: receipt.reportId, reportHash: fileHash }), receipt.proof);
  if (root !== receipt.block.merkleRoot.toLowerCase()) return { ok: false, reason: "PROOF_INVALID" };

  const { hash, ...header } = receipt.block;
  if (blockHash(header) !== hash.toLowerCase()) return { ok: false, reason: "BLOCK_HASH_INVALID" };
  return { ok: true };
}

export interface LedgerStore {
  load(): LedgerState;
  save(state: LedgerState): void;
}

export class MemoryStore implements LedgerStore {
  private state = emptyState();
  load() { return structuredClone(this.state); }
  save(state: LedgerState) { this.state = structuredClone(state); }
}

/** 단일 프로세스용 JSON 파일 저장소. 임시 파일에 쓴 뒤 rename해서 중간에 깨진 파일이 남지 않게 한다. */
export class JsonFileStore implements LedgerStore {
  constructor(private readonly path: string) {}

  load(): LedgerState {
    if (!existsSync(this.path)) return emptyState();
    const state = JSON.parse(readFileSync(this.path, "utf8")) as LedgerState;
    if (state.version !== LEDGER_VERSION) throw new Error(`지원하지 않는 원장 버전: ${state.version}`);
    return state;
  }

  save(state: LedgerState) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.path);
  }
}

export class Ledger {
  constructor(private readonly store: LedgerStore, private readonly now: () => number = Date.now) {}

  state(): LedgerState {
    return this.store.load();
  }

  /** 리포트 해시를 대기열에 추가. 같은 리포트 ID는 원장 전체에서 한 번만 기록된다. */
  submit(reportId: string, reportHash: string): LedgerEntry {
    const id = reportId.trim();
    const hash = toHex(hexToBuf(reportHash));
    toReportKey(id); // 빈 ID면 여기서 예외

    const state = this.store.load();
    const exists = state.pending.some((e) => e.reportId === id)
      || state.blocks.some((b) => b.entries.some((e) => e.reportId === id));
    if (exists) throw new Error(`${id}는 이미 원장에 있습니다. 같은 ID는 다시 기록할 수 없습니다.`);

    const entry = { reportId: id, reportHash: hash, submittedAt: new Date(this.now()).toISOString() };
    state.pending.push(entry);
    this.store.save(state);
    return entry;
  }

  /** 대기열 전체를 블록 하나로 확정 */
  seal(): LedgerBlock {
    const state = this.store.load();
    if (state.pending.length === 0) throw new Error("확정할 대기 기록이 없습니다.");

    const prev = state.blocks.at(-1);
    const entries = state.pending;
    const header: BlockHeader = {
      height: state.blocks.length,
      prevHash: prev?.hash ?? GENESIS_PREV_HASH,
      merkleRoot: merkleRoot(entries.map(entryLeaf)),
      createdAt: Math.max(this.now(), prev?.createdAt ?? 0),
      entryCount: entries.length,
    };
    const block: LedgerBlock = { ...header, hash: blockHash(header), entries };

    state.blocks.push(block);
    state.pending = [];
    this.store.save(state);
    return block;
  }

  receipt(reportId: string): Receipt {
    const id = reportId.trim();
    const state = this.store.load();
    for (const block of state.blocks) {
      const index = block.entries.findIndex((e) => e.reportId === id);
      if (index === -1) continue;
      return {
        version: LEDGER_VERSION,
        reportId: id,
        reportHash: block.entries[index].reportHash,
        leafIndex: index,
        proof: merkleProof(block.entries.map(entryLeaf), index),
        block: { ...headerOf(block), hash: block.hash },
        ...(block.anchor && { anchor: block.anchor }),
      };
    }
    if (state.pending.some((e) => e.reportId === id)) {
      throw new Error(`${id}는 아직 블록으로 확정되지 않았습니다. seal 후 영수증을 발급하세요.`);
    }
    throw new Error(`${id}는 원장에 없습니다.`);
  }

  unanchoredBlocks(): LedgerBlock[] {
    return this.store.load().blocks.filter((b) => !b.anchor);
  }

  markAnchored(height: number, anchor: BlockAnchor) {
    const state = this.store.load();
    const block = state.blocks[height];
    if (!block) throw new Error(`블록 #${height}이 없습니다.`);
    block.anchor = anchor;
    this.store.save(state);
  }

  /** 원장 전체를 다시 계산해 연결·해시·중복을 점검한다. */
  audit(): { ok: boolean; problems: string[] } {
    const state = this.store.load();
    const problems: string[] = [];
    const seen = new Set<string>();

    state.blocks.forEach((block, i) => {
      const where = `블록 #${i}`;
      if (block.height !== i) problems.push(`${where}: height가 ${block.height}로 기록됨`);
      const expectedPrev = i === 0 ? GENESIS_PREV_HASH : state.blocks[i - 1].hash;
      if (block.prevHash !== expectedPrev) problems.push(`${where}: 이전 블록과 연결이 끊김`);
      if (i > 0 && block.createdAt < state.blocks[i - 1].createdAt) problems.push(`${where}: 생성 시각이 이전 블록보다 앞섬`);
      if (block.entryCount !== block.entries.length) problems.push(`${where}: 기록 수 불일치`);
      if (block.entries.length === 0 || merkleRoot(block.entries.map(entryLeaf)) !== block.merkleRoot) {
        problems.push(`${where}: 기록 내용이 merkleRoot와 다름`);
      }
      if (blockHash(headerOf(block)) !== block.hash) problems.push(`${where}: 블록 해시 불일치`);
      for (const entry of block.entries) {
        if (seen.has(entry.reportId)) problems.push(`${where}: ${entry.reportId} 중복 기록`);
        seen.add(entry.reportId);
      }
    });

    return { ok: problems.length === 0, problems };
  }
}
