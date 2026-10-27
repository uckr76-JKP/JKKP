import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { Ledger, LedgerState, MemoryStore, blockAnchorKey, verifyReceipt } from "../lib/ledger";
import { leafHash, merkleProof, merkleRoot, rootFromProof } from "../lib/merkle";
import { hashReportBytes } from "../lib/proof";

const report = (text: string) => hashReportBytes(new TextEncoder().encode(text));

function setup() {
  const store = new MemoryStore();
  let clock = Date.parse("2026-10-28T09:00:00Z");
  const ledger = new Ledger(store, () => (clock += 1000));
  // 저장소 내용을 직접 고쳐 위·변조를 흉내낼 때 사용
  const tamper = (fn: (state: LedgerState) => void) => {
    const state = store.load();
    fn(state);
    store.save(state);
  };
  return { ledger, tamper };
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

describe("Ledger", () => {
  it("submit → seal → receipt, 원본 파일이면 영수증 검증 통과", () => {
    const { ledger } = setup();
    ["VR-1", "VR-2", "VR-3"].forEach((id) => ledger.submit(id, report(id)));
    const block = ledger.seal();

    expect(block.height).to.equal(0);
    expect(block.entryCount).to.equal(3);
    const receipt = ledger.receipt("VR-2");
    expect(receipt.block.hash).to.equal(block.hash);
    expect(verifyReceipt(receipt, report("VR-2"))).to.deep.equal({ ok: true });
  });

  it("블록끼리 prevHash로 연결", () => {
    const { ledger } = setup();
    ledger.submit("VR-1", report("1"));
    const b0 = ledger.seal();
    ledger.submit("VR-2", report("2"));
    const b1 = ledger.seal();

    expect(b0.prevHash).to.equal("0x" + "00".repeat(32));
    expect(b1.prevHash).to.equal(b0.hash);
    expect(ledger.audit()).to.deep.equal({ ok: true, problems: [] });
  });

  it("변조된 파일은 HASH_MISMATCH", () => {
    const { ledger } = setup();
    ledger.submit("VR-1", report("Result: 1,250,000 KRW"));
    ledger.seal();
    const receipt = ledger.receipt("VR-1");
    expect(verifyReceipt(receipt, report("Result: 1,350,000 KRW"))).to.deep.equal({ ok: false, reason: "HASH_MISMATCH" });
  });

  it("영수증의 해시만 바꿔치기하면 PROOF_INVALID", () => {
    const { ledger } = setup();
    ["VR-1", "VR-2"].forEach((id) => ledger.submit(id, report(id)));
    ledger.seal();
    const receipt = { ...ledger.receipt("VR-1"), reportHash: report("forged") };
    expect(verifyReceipt(receipt, report("forged"))).to.deep.equal({ ok: false, reason: "PROOF_INVALID" });
  });

  it("영수증 블록 헤더를 고치면 BLOCK_HASH_INVALID", () => {
    const { ledger } = setup();
    ledger.submit("VR-1", report("1"));
    ledger.seal();
    const receipt = ledger.receipt("VR-1");
    receipt.block.createdAt += 1;
    expect(verifyReceipt(receipt, report("1"))).to.deep.equal({ ok: false, reason: "BLOCK_HASH_INVALID" });
  });

  it("같은 리포트 ID는 대기열·확정 블록 어디에 있든 거부", () => {
    const { ledger } = setup();
    ledger.submit("VR-1", report("1"));
    expect(() => ledger.submit("VR-1", report("other"))).to.throw("이미 원장에");
    ledger.seal();
    expect(() => ledger.submit("VR-1", report("other"))).to.throw("이미 원장에");
  });

  it("대기 기록 없이 seal, 확정 전 receipt는 거부", () => {
    const { ledger } = setup();
    expect(() => ledger.seal()).to.throw("대기 기록이 없습니다");
    ledger.submit("VR-1", report("1"));
    expect(() => ledger.receipt("VR-1")).to.throw("아직 블록으로 확정되지");
    expect(() => ledger.receipt("VR-404")).to.throw("원장에 없습니다");
  });

  it("잘못된 해시 형식은 거부", () => {
    const { ledger } = setup();
    expect(() => ledger.submit("VR-1", "0x1234")).to.throw("32바이트");
  });

  it("audit: 원장의 기록 해시를 고치면 감지", () => {
    const { ledger, tamper } = setup();
    ["VR-1", "VR-2"].forEach((id) => ledger.submit(id, report(id)));
    ledger.seal();
    tamper((s) => { s.blocks[0].entries[1].reportHash = report("forged"); });

    const result = ledger.audit();
    expect(result.ok).to.equal(false);
    expect(result.problems).to.include("블록 #0: 기록 내용이 merkleRoot와 다름");
  });

  it("audit: 중간 블록을 지우면 연결 끊김 감지", () => {
    const { ledger, tamper } = setup();
    for (const id of ["VR-1", "VR-2", "VR-3"]) {
      ledger.submit(id, report(id));
      ledger.seal();
    }
    tamper((s) => { s.blocks.splice(1, 1); });

    const result = ledger.audit();
    expect(result.ok).to.equal(false);
    expect(result.problems).to.include("블록 #1: 이전 블록과 연결이 끊김");
  });

  it("audit: 블록을 통째로 다시 계산해 바꿔도 다음 블록 연결에서 감지", () => {
    const { ledger, tamper } = setup();
    for (const id of ["VR-1", "VR-2"]) {
      ledger.submit(id, report(id));
      ledger.seal();
    }
    // 공격자가 블록 #0의 기록과 merkleRoot, hash까지 모두 맞춰 다시 만든 경우
    const forged = new Ledger(new MemoryStore(), () => Date.parse("2026-10-28T09:00:01Z"));
    forged.submit("VR-1", report("forged"));
    const forgedBlock = forged.seal();
    tamper((s) => { s.blocks[0] = { ...forgedBlock }; });

    expect(ledger.audit().problems).to.include("블록 #1: 이전 블록과 연결이 끊김");
  });
});

describe("Ledger + 공개 체인 앵커", () => {
  async function deploy() {
    const registry = await ethers.deployContract("SettlementProofRegistry");
    return { registry };
  }

  it("블록 해시를 앵커하면 영수증 블록과 체인 기록이 일치", async () => {
    const { registry } = await loadFixture(deploy);
    const { ledger } = setup();
    ["VR-1", "VR-2", "VR-3", "VR-4", "VR-5"].forEach((id) => ledger.submit(id, report(id)));
    const block = ledger.seal();

    await registry.anchor(blockAnchorKey(block.height), block.hash);

    const receipt = ledger.receipt("VR-4");
    expect(verifyReceipt(receipt, report("VR-4")).ok).to.equal(true);
    expect(await registry.verify(blockAnchorKey(receipt.block.height), receipt.block.hash)).to.equal(true);
  });

  it("영수증 블록 해시가 체인 기록과 다르면 false", async () => {
    const { registry } = await loadFixture(deploy);
    const { ledger } = setup();
    ledger.submit("VR-1", report("1"));
    const block = ledger.seal();
    await registry.anchor(blockAnchorKey(block.height), block.hash);

    expect(await registry.verify(blockAnchorKey(block.height), report("not-the-block"))).to.equal(false);
  });

  it("블록 앵커 키는 리포트 ID 키와 겹치지 않음", () => {
    expect(blockAnchorKey(0)).to.equal(ethers.id("VB-LEDGER-v1-BLOCK-0"));
    expect(blockAnchorKey(0)).to.not.equal(ethers.id("VR-0"));
  });
});
