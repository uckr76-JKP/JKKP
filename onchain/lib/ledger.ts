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

export type SealedHeader = BlockHeader & { hash: string; anchor?: BlockAnchor };

export type LedgerBlock = SealedHeader & { entries: LedgerEntry[] };

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

export type EntryLocation = { status: "pending" } | { status: "sealed"; height: number };

export class DuplicateReportError extends Error {
  constructor(reportId: string) {
    super(`${reportId}는 이미 원장에 있습니다. 같은 ID는 다시 기록할 수 없습니다.`);
  }
}

/** 블록을 붙이려는 사이 head가 바뀌었거나 대기 기록이 다른 블록에 들어간 경우. 다시 읽고 재시도하면 된다. */
export class SealConflictError extends Error {}

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

export function headerOf(block: BlockHeader): BlockHeader {
  const { height, prevHash, merkleRoot, createdAt, entryCount } = block;
  return { height, prevHash, merkleRoot, createdAt, entryCount };
}

/** prev 위에 entries를 담은 다음 블록을 계산한다. 저장은 하지 않는다. */
export function buildBlock(prev: SealedHeader | null, entries: LedgerEntry[], now: number): LedgerBlock {
  const header: BlockHeader = {
    height: prev ? prev.height + 1 : 0,
    prevHash: prev?.hash ?? GENESIS_PREV_HASH,
    merkleRoot: merkleRoot(entries.map(entryLeaf)),
    createdAt: Math.max(now, prev?.createdAt ?? 0),
    entryCount: entries.length,
  };
  return { ...header, hash: blockHash(header), entries };
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

/** 블록 목록 전체를 다시 계산해 연결·해시·중복을 점검한다. */
export function auditBlocks(blocks: LedgerBlock[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();

  blocks.forEach((block, i) => {
    const where = `블록 #${i}`;
    if (block.height !== i) problems.push(`${where}: height가 ${block.height}로 기록됨`);
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : blocks[i - 1].hash;
    if (block.prevHash !== expectedPrev) problems.push(`${where}: 이전 블록과 연결이 끊김`);
    if (i > 0 && block.createdAt < blocks[i - 1].createdAt) problems.push(`${where}: 생성 시각이 이전 블록보다 앞섬`);
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

/**
 * 원장 저장소. 구현체는 다음을 보장해야 한다.
 * - addPending: 원장 전체(대기·확정)에서 reportId 유일, 아니면 DuplicateReportError
 * - pending: 제출 순서대로
 * - appendBlock: 현재 head 바로 위이고 block.entries가 모두 아직 대기 상태일 때만 원자적으로 추가, 아니면 SealConflictError
 */
export interface LedgerStore {
  addPending(entry: LedgerEntry): Promise<void>;
  pending(): Promise<LedgerEntry[]>;
  head(): Promise<SealedHeader | null>;
  appendBlock(block: LedgerBlock): Promise<void>;
  block(height: number): Promise<LedgerBlock | null>;
  blocks(): Promise<LedgerBlock[]>;
  locate(reportId: string): Promise<EntryLocation | null>;
  unanchored(): Promise<SealedHeader[]>;
  markAnchored(height: number, anchor: BlockAnchor): Promise<void>;
}

type LedgerState = { version: string; blocks: LedgerBlock[]; pending: LedgerEntry[] };

/** 전체 상태를 한 번에 읽고 쓰는 저장소(메모리·JSON 파일)의 공통 구현. 단일 프로세스 전용. */
abstract class SnapshotStore implements LedgerStore {
  protected abstract read(): LedgerState;
  protected abstract write(state: LedgerState): void;

  async addPending(entry: LedgerEntry) {
    const state = this.read();
    if (findLocation(state, entry.reportId)) throw new DuplicateReportError(entry.reportId);
    state.pending.push(entry);
    this.write(state);
  }

  async pending() {
    return this.read().pending;
  }

  async head() {
    const last = this.read().blocks.at(-1);
    return last ? stripEntries(last) : null;
  }

  async appendBlock(block: LedgerBlock) {
    const state = this.read();
    const head = state.blocks.at(-1);
    if (block.height !== state.blocks.length || block.prevHash !== (head?.hash ?? GENESIS_PREV_HASH)) {
      throw new SealConflictError(`head가 #${head?.height ?? "없음"}로 바뀌었습니다.`);
    }
    const ids = new Set(block.entries.map((e) => e.reportId));
    const stillPending = state.pending.filter((e) => ids.has(e.reportId));
    if (ids.size !== block.entries.length || stillPending.length !== ids.size) {
      throw new SealConflictError("대기 상태가 아닌 기록이 포함되어 있습니다.");
    }
    state.blocks.push(block);
    state.pending = state.pending.filter((e) => !ids.has(e.reportId));
    this.write(state);
  }

  async block(height: number) {
    return this.read().blocks[height] ?? null;
  }

  async blocks() {
    return this.read().blocks;
  }

  async locate(reportId: string) {
    return findLocation(this.read(), reportId);
  }

  async unanchored() {
    return this.read().blocks.filter((b) => !b.anchor).map(stripEntries);
  }

  async markAnchored(height: number, anchor: BlockAnchor) {
    const state = this.read();
    const block = state.blocks[height];
    if (!block) throw new Error(`블록 #${height}이 없습니다.`);
    if (block.anchor) throw new Error(`블록 #${height}의 앵커 정보는 이미 기록되어 있습니다.`);
    block.anchor = anchor;
    this.write(state);
  }
}

function emptyState(): LedgerState {
  return { version: LEDGER_VERSION, blocks: [], pending: [] };
}

function stripEntries({ entries, ...header }: LedgerBlock): SealedHeader {
  return header;
}

function findLocation(state: LedgerState, reportId: string): EntryLocation | null {
  if (state.pending.some((e) => e.reportId === reportId)) return { status: "pending" };
  const block = state.blocks.find((b) => b.entries.some((e) => e.reportId === reportId));
  return block ? { status: "sealed", height: block.height } : null;
}

export class MemoryStore extends SnapshotStore {
  private state = emptyState();
  protected read() { return structuredClone(this.state); }
  protected write(state: LedgerState) { this.state = structuredClone(state); }

  /** 테스트용: 저장된 내용을 직접 고쳐 위·변조를 흉내낸다. */
  tamper(fn: (state: LedgerState) => void) {
    fn(this.state);
  }
}

/** JSON 파일 저장소. 임시 파일에 쓴 뒤 rename해서 중간에 깨진 파일이 남지 않게 한다. */
export class JsonFileStore extends SnapshotStore {
  constructor(private readonly path: string) {
    super();
  }

  protected read(): LedgerState {
    if (!existsSync(this.path)) return emptyState();
    const state = JSON.parse(readFileSync(this.path, "utf8")) as LedgerState;
    if (state.version !== LEDGER_VERSION) throw new Error(`지원하지 않는 원장 버전: ${state.version}`);
    return state;
  }

  protected write(state: LedgerState) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.path);
  }
}

export class Ledger {
  constructor(private readonly store: LedgerStore, private readonly now: () => number = Date.now) {}

  /** 리포트 해시를 대기열에 추가. 같은 리포트 ID는 원장 전체에서 한 번만 기록된다. */
  async submit(reportId: string, reportHash: string): Promise<LedgerEntry> {
    const id = reportId.trim();
    toReportKey(id); // 빈 ID면 여기서 예외
    const entry = { reportId: id, reportHash: toHex(hexToBuf(reportHash)), submittedAt: new Date(this.now()).toISOString() };
    await this.store.addPending(entry);
    return entry;
  }

  /** 대기열 전체를 블록 하나로 확정. 다른 프로세스와 경합하면 다시 읽고 재시도한다. */
  async seal(maxAttempts = 3): Promise<LedgerBlock> {
    for (let attempt = 1; ; attempt++) {
      const pending = await this.store.pending();
      if (pending.length === 0) throw new Error("확정할 대기 기록이 없습니다.");
      const block = buildBlock(await this.store.head(), pending, this.now());
      try {
        await this.store.appendBlock(block);
        return block;
      } catch (error) {
        if (!(error instanceof SealConflictError) || attempt >= maxAttempts) throw error;
      }
    }
  }

  async receipt(reportId: string): Promise<Receipt> {
    const id = reportId.trim();
    const location = await this.store.locate(id);
    if (!location) throw new Error(`${id}는 원장에 없습니다.`);
    if (location.status === "pending") {
      throw new Error(`${id}는 아직 블록으로 확정되지 않았습니다. seal 후 영수증을 발급하세요.`);
    }

    const block = await this.store.block(location.height);
    const index = block?.entries.findIndex((e) => e.reportId === id) ?? -1;
    if (!block || index === -1) throw new Error(`블록 #${location.height}에서 ${id}를 찾지 못했습니다.`);

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

  unanchoredBlocks(): Promise<SealedHeader[]> {
    return this.store.unanchored();
  }

  markAnchored(height: number, anchor: BlockAnchor): Promise<void> {
    return this.store.markAnchored(height, anchor);
  }

  async audit() {
    return auditBlocks(await this.store.blocks());
  }

  async status() {
    const [head, pending, unanchored] = await Promise.all([this.store.head(), this.store.pending(), this.store.unanchored()]);
    return {
      blocks: head ? head.height + 1 : 0,
      pending: pending.length,
      unanchored: unanchored.map((b) => b.height),
      head: head?.hash ?? null,
    };
  }
}
