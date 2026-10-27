import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { PGlite } from "@electric-sql/pglite";
import {
  DuplicateReportError,
  Ledger,
  LedgerStore,
  MemoryStore,
  SealConflictError,
  blockAnchorKey,
  buildBlock,
  verifyReceipt,
} from "../lib/ledger";
import { PostgresStore, applyMigrations } from "../lib/ledger-postgres";
import { leafHash, merkleProof, merkleRoot, rootFromProof } from "../lib/merkle";
import { hashReportBytes } from "../lib/proof";

const report = (text: string) => hashReportBytes(new TextEncoder().encode(text));

function clock() {
  let now = Date.parse("2026-10-28T09:00:00Z");
  return () => (now += 1000);
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("예외가 발생해야 합니다.");
}

async function freshPglite() {
  const db = await PGlite.create();
  await applyMigrations((sql) => db.exec(sql), false);
  return db;
}

describe("Merkle", () => {
  it("리프 1~9개 모든 위치에서 증명으로 root 복원", () => {
    for (let n = 1; n <= 9; n++) {
      const leaves = Array.from({ length: n }, (_, i) => leafHash(ethers.id(`R-${i}`), report(`r${i}`)));
      const root = merkleRoot(leaves);
      leaves.forEach((leaf, i) => expect(rootFromProof(leaf, merkleProof(leaves, i)), `n=${n} i=${i}`).to.equal(root));
    }
  });

  it("다른 리프로는 같은 root가 나오지 않음", () => {
    const leaves = ["a", "b", "c"].map((s) => leafHash(ethers.id(s), report(s)));
    const forged = leafHash(ethers.id("a"), report("a-forged"));
    expect(rootFromProof(forged, merkleProof(leaves, 0))).to.not.equal(merkleRoot(leaves));
  });
});

// 저장소 구현과 무관하게 같아야 하는 동작
const stores: [string, () => Promise<{ store: LedgerStore; close?: () => Promise<void> }>][] = [
  ["MemoryStore", async () => ({ store: new MemoryStore() })],
  ["PostgresStore (PGlite)", async () => {
    const db = await freshPglite();
    return { store: new PostgresStore(db), close: () => db.close() };
  }],
];

for (const [name, makeStore] of stores) {
  describe(`Ledger · ${name}`, function () {
    this.timeout(20000);
    let store: LedgerStore;
    let ledger: Ledger;
    let close: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      ({ store, close } = await makeStore());
      ledger = new Ledger(store, clock());
    });
    afterEach(async () => close?.());

    it("submit → seal → receipt, 원본 파일이면 영수증 검증 통과", async () => {
      for (const id of ["VR-1", "VR-2", "VR-3"]) await ledger.submit(id, report(id));
      const block = await ledger.seal();

      expect(block.height).to.equal(0);
      expect(block.entryCount).to.equal(3);
      const receipt = await ledger.receipt("VR-2");
      expect(receipt.leafIndex).to.equal(1);
      expect(receipt.block.hash).to.equal(block.hash);
      expect(verifyReceipt(receipt, report("VR-2"))).to.deep.equal({ ok: true });
    });

    it("블록끼리 prevHash로 연결, audit 통과", async () => {
      await ledger.submit("VR-1", report("1"));
      const b0 = await ledger.seal();
      await ledger.submit("VR-2", report("2"));
      const b1 = await ledger.seal();

      expect(b0.prevHash).to.equal("0x" + "00".repeat(32));
      expect(b1.prevHash).to.equal(b0.hash);
      expect(await ledger.audit()).to.deep.equal({ ok: true, problems: [] });
      expect(await ledger.status()).to.deep.equal({ blocks: 2, pending: 0, unanchored: [0, 1], head: b1.hash });
    });

    it("저장소에서 다시 읽은 블록으로 만든 영수증도 동일한 블록 해시", async () => {
      for (const id of ["VR-1", "VR-2", "VR-3", "VR-4", "VR-5"]) await ledger.submit(id, report(id));
      const sealed = await ledger.seal();
      for (const id of ["VR-1", "VR-3", "VR-5"]) {
        const receipt = await ledger.receipt(id);
        expect(receipt.block.hash).to.equal(sealed.hash);
        expect(verifyReceipt(receipt, report(id)).ok).to.equal(true);
      }
    });

    it("변조된 파일은 HASH_MISMATCH", async () => {
      await ledger.submit("VR-1", report("Result: 1,250,000 KRW"));
      await ledger.seal();
      const receipt = await ledger.receipt("VR-1");
      expect(verifyReceipt(receipt, report("Result: 1,350,000 KRW"))).to.deep.equal({ ok: false, reason: "HASH_MISMATCH" });
    });

    it("영수증의 해시만 바꿔치기하면 PROOF_INVALID", async () => {
      for (const id of ["VR-1", "VR-2"]) await ledger.submit(id, report(id));
      await ledger.seal();
      const receipt = { ...(await ledger.receipt("VR-1")), reportHash: report("forged") };
      expect(verifyReceipt(receipt, report("forged"))).to.deep.equal({ ok: false, reason: "PROOF_INVALID" });
    });

    it("영수증 블록 헤더를 고치면 BLOCK_HASH_INVALID", async () => {
      await ledger.submit("VR-1", report("1"));
      await ledger.seal();
      const receipt = await ledger.receipt("VR-1");
      receipt.block.createdAt += 1;
      expect(verifyReceipt(receipt, report("1"))).to.deep.equal({ ok: false, reason: "BLOCK_HASH_INVALID" });
    });

    it("같은 리포트 ID는 대기열·확정 블록 어디에 있든 거부", async () => {
      await ledger.submit("VR-1", report("1"));
      expect(await rejection(ledger.submit("VR-1", report("other")))).to.be.instanceOf(DuplicateReportError);
      await ledger.seal();
      expect(await rejection(ledger.submit("VR-1", report("other")))).to.be.instanceOf(DuplicateReportError);
    });

    it("대기 기록 없이 seal, 확정 전·없는 ID receipt는 거부", async () => {
      expect((await rejection(ledger.seal())).message).to.include("대기 기록이 없습니다");
      await ledger.submit("VR-1", report("1"));
      expect((await rejection(ledger.receipt("VR-1"))).message).to.include("아직 블록으로 확정되지");
      expect((await rejection(ledger.receipt("VR-404"))).message).to.include("원장에 없습니다");
    });

    it("잘못된 해시 형식은 거부", async () => {
      expect((await rejection(ledger.submit("VR-1", "0x1234"))).message).to.include("32바이트");
    });

    it("seal 이후 들어온 기록은 다음 블록으로", async () => {
      await ledger.submit("VR-1", report("1"));
      await ledger.seal();
      await ledger.submit("VR-2", report("2"));
      expect((await ledger.status()).pending).to.equal(1);
      const b1 = await ledger.seal();
      expect(b1.entries.map((e) => e.reportId)).to.deep.equal(["VR-2"]);
    });

    it("오래된 head 위에 블록을 붙이려 하면 SealConflictError", async () => {
      await ledger.submit("VR-1", report("1"));
      await ledger.seal();
      await ledger.submit("VR-2", report("2"));
      const stale = buildBlock(null, await store.pending(), Date.now()); // 제네시스 위에 다시 붙이려는 블록
      expect(await rejection(store.appendBlock(stale))).to.be.instanceOf(SealConflictError);
    });

    it("이미 다른 블록에 들어간 기록으로 블록을 만들면 SealConflictError", async () => {
      await ledger.submit("VR-1", report("1"));
      const pending = await store.pending();
      const b0 = await ledger.seal();
      const reused = buildBlock(b0, pending, Date.now());
      expect(await rejection(store.appendBlock(reused))).to.be.instanceOf(SealConflictError);
    });

    it("앵커 정보 기록 후 unanchored에서 빠지고, 두 번 기록은 거부", async () => {
      await ledger.submit("VR-1", report("1"));
      await ledger.seal();
      const anchor = { network: "localhost", txHash: "0xabc", anchoredAt: "2026-10-28T10:00:00.000Z" };
      await ledger.markAnchored(0, anchor);
      expect(await ledger.unanchoredBlocks()).to.deep.equal([]);
      expect((await ledger.receipt("VR-1")).anchor).to.deep.equal(anchor);
      await rejection(ledger.markAnchored(0, anchor));
    });
  });
}

describe("MemoryStore 위·변조 감지 (audit)", () => {
  function setup() {
    const store = new MemoryStore();
    return { store, ledger: new Ledger(store, clock()) };
  }

  it("원장의 기록 해시를 고치면 감지", async () => {
    const { store, ledger } = setup();
    for (const id of ["VR-1", "VR-2"]) await ledger.submit(id, report(id));
    await ledger.seal();
    store.tamper((s) => { s.blocks[0].entries[1].reportHash = report("forged"); });

    const result = await ledger.audit();
    expect(result.ok).to.equal(false);
    expect(result.problems).to.include("블록 #0: 기록 내용이 merkleRoot와 다름");
  });

  it("중간 블록을 지우면 연결 끊김 감지", async () => {
    const { store, ledger } = setup();
    for (const id of ["VR-1", "VR-2", "VR-3"]) {
      await ledger.submit(id, report(id));
      await ledger.seal();
    }
    store.tamper((s) => { s.blocks.splice(1, 1); });
    expect((await ledger.audit()).problems).to.include("블록 #1: 이전 블록과 연결이 끊김");
  });

  it("블록을 통째로 다시 계산해 바꿔도 다음 블록 연결에서 감지", async () => {
    const { store, ledger } = setup();
    for (const id of ["VR-1", "VR-2"]) {
      await ledger.submit(id, report(id));
      await ledger.seal();
    }
    // 공격자가 블록 #0의 기록과 merkleRoot, hash까지 모두 맞춰 다시 만든 경우
    const forged = buildBlock(null, [{ reportId: "VR-1", reportHash: report("forged"), submittedAt: "" }], Date.now());
    store.tamper((s) => { s.blocks[0] = forged; });
    expect((await ledger.audit()).problems).to.include("블록 #1: 이전 블록과 연결이 끊김");
  });
});

describe("PostgresStore 전용", function () {
  this.timeout(20000);
  let db: PGlite;
  let ledger: Ledger;

  beforeEach(async () => {
    db = await freshPglite();
    ledger = new Ledger(new PostgresStore(db), clock());
    for (const id of ["VR-1", "VR-2"]) await ledger.submit(id, report(id));
    await ledger.seal();
  });
  afterEach(async () => db.close());

  it("마이그레이션은 여러 번 적용해도 안전", async () => {
    await applyMigrations((sql) => db.exec(sql), false);
    expect((await ledger.audit()).ok).to.equal(true);
  });

  it("트리거: 기록 해시 수정 불가", async () => {
    const error = await rejection(db.query("update ledger_entries set report_hash = $1 where report_id = 'VR-1'", [report("x")]));
    expect(error.message).to.include("LEDGER_APPEND_ONLY");
  });

  it("트리거: 기록·블록 삭제 불가", async () => {
    expect((await rejection(db.query("delete from ledger_entries where report_id = 'VR-1'"))).message).to.include("LEDGER_APPEND_ONLY");
    expect((await rejection(db.query("delete from ledger_blocks where height = 0"))).message).to.include("LEDGER_APPEND_ONLY");
  });

  it("트리거: 블록 헤더 수정 불가, 확정된 기록을 다른 블록으로 옮기기 불가", async () => {
    expect((await rejection(db.query("update ledger_blocks set merkle_root = $1 where height = 0", [report("x")])))
      .message).to.include("LEDGER_APPEND_ONLY");
    expect((await rejection(db.query("update ledger_entries set leaf_index = 5 where report_id = 'VR-1'"))).message)
      .to.include("LEDGER_APPEND_ONLY");
  });

  it("CHECK: 대문자·길이가 틀린 해시는 DB에서도 거부", async () => {
    const error = await rejection(db.query(
      "insert into ledger_entries (report_id, report_hash, submitted_at) values ('VR-X', '0xABC', now())",
    ));
    expect(error.message).to.match(/check constraint/i);
  });

  it("동시에 seal해도 블록이 갈라지지 않음 (한쪽은 재시도 후 '대기 기록 없음')", async () => {
    await ledger.submit("VR-3", report("3"));
    const store = new PostgresStore(db);
    const a = new Ledger(store, clock());
    const b = new Ledger(store, clock());
    const results = await Promise.allSettled([a.seal(), b.seal()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).to.have.length(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).to.include("대기 기록이 없습니다");
    expect(await ledger.status()).to.include({ blocks: 2, pending: 0 });
    expect((await ledger.audit()).ok).to.equal(true);
  });

  it("DB 관리자가 트리거를 끄고 고쳐도 audit이 감지", async () => {
    await db.exec("alter table ledger_entries disable trigger ledger_entries_guard");
    await db.query("update ledger_entries set report_hash = $1 where report_id = 'VR-2'", [report("forged")]);

    const result = await ledger.audit();
    expect(result.ok).to.equal(false);
    expect(result.problems).to.include("블록 #0: 기록 내용이 merkleRoot와 다름");
  });
});

describe("Ledger + 공개 체인 앵커", () => {
  async function deploy() {
    const registry = await ethers.deployContract("SettlementProofRegistry");
    return { registry };
  }

  it("블록 해시를 앵커하면 영수증 블록과 체인 기록이 일치", async () => {
    const { registry } = await loadFixture(deploy);
    const ledger = new Ledger(new MemoryStore(), clock());
    for (const id of ["VR-1", "VR-2", "VR-3", "VR-4", "VR-5"]) await ledger.submit(id, report(id));
    const block = await ledger.seal();

    await registry.anchor(blockAnchorKey(block.height), block.hash);

    const receipt = await ledger.receipt("VR-4");
    expect(verifyReceipt(receipt, report("VR-4")).ok).to.equal(true);
    expect(await registry.verify(blockAnchorKey(receipt.block.height), receipt.block.hash)).to.equal(true);
  });

  it("영수증 블록 해시가 체인 기록과 다르면 false", async () => {
    const { registry } = await loadFixture(deploy);
    const ledger = new Ledger(new MemoryStore(), clock());
    await ledger.submit("VR-1", report("1"));
    const block = await ledger.seal();
    await registry.anchor(blockAnchorKey(block.height), block.hash);

    expect(await registry.verify(blockAnchorKey(block.height), report("not-the-block"))).to.equal(false);
  });

  it("블록 앵커 키는 리포트 ID 키와 겹치지 않음", () => {
    expect(blockAnchorKey(0)).to.equal(ethers.id("VB-LEDGER-v1-BLOCK-0"));
    expect(blockAnchorKey(0)).to.not.equal(ethers.id("VR-0"));
  });
});
