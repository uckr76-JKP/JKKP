import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { hashReportBytes, toReportKey } from "../lib/proof";

const REPORT_ID = "VR-2026-10-0001";
const REPORT = new TextEncoder().encode("Settlement Report | Source: Platform Sales | Result: 1,250,000 KRW");

describe("SettlementProofRegistry", () => {
  async function deploy() {
    const [owner, recorder, outsider] = await ethers.getSigners();
    const registry = await ethers.deployContract("SettlementProofRegistry");
    return { registry, owner, recorder, outsider };
  }

  it("리포트 해시를 기록하고 같은 파일이면 MATCH", async () => {
    const { registry, owner } = await loadFixture(deploy);
    const key = toReportKey(REPORT_ID);
    const hash = hashReportBytes(REPORT);

    await expect(registry.anchor(key, hash))
      .to.emit(registry, "ProofAnchored")
      .withArgs(key, hash, owner.address, (t: bigint) => t > 0n);

    expect(await registry.verify(key, hash)).to.equal(true);
    const proof = await registry.getProof(key);
    expect(proof.reportHash).to.equal(hash);
    expect(proof.recorder).to.equal(owner.address);
  });

  it("한 글자라도 바뀐 리포트는 MISMATCH", async () => {
    const { registry } = await loadFixture(deploy);
    const key = toReportKey(REPORT_ID);
    await registry.anchor(key, hashReportBytes(REPORT));

    const tampered = new TextEncoder().encode("Settlement Report | Source: Platform Sales | Result: 1,350,000 KRW");
    expect(await registry.verify(key, hashReportBytes(tampered))).to.equal(false);
  });

  it("같은 리포트 ID는 덮어쓸 수 없음", async () => {
    const { registry } = await loadFixture(deploy);
    const key = toReportKey(REPORT_ID);
    await registry.anchor(key, hashReportBytes(REPORT));

    await expect(registry.anchor(key, hashReportBytes(new Uint8Array([1]))))
      .to.be.revertedWithCustomError(registry, "AlreadyAnchored")
      .withArgs(key);
  });

  it("기록 없는 ID는 verify false, anchoredAt 0", async () => {
    const { registry } = await loadFixture(deploy);
    const key = toReportKey("VR-NOT-EXIST");
    expect(await registry.verify(key, hashReportBytes(REPORT))).to.equal(false);
    expect((await registry.getProof(key)).anchoredAt).to.equal(0n);
  });

  it("빈 해시는 거부", async () => {
    const { registry } = await loadFixture(deploy);
    await expect(registry.anchor(toReportKey(REPORT_ID), ethers.ZeroHash))
      .to.be.revertedWithCustomError(registry, "InvalidHash");
  });

  it("권한 없는 계정은 기록 불가, owner가 recorder 추가하면 가능", async () => {
    const { registry, recorder, outsider } = await loadFixture(deploy);
    const key = toReportKey(REPORT_ID);
    const hash = hashReportBytes(REPORT);

    await expect(registry.connect(recorder).anchor(key, hash))
      .to.be.revertedWithCustomError(registry, "NotRecorder");
    await expect(registry.connect(outsider).setRecorder(recorder.address, true))
      .to.be.revertedWithCustomError(registry, "NotOwner");

    await registry.setRecorder(recorder.address, true);
    await expect(registry.connect(recorder).anchor(key, hash)).to.emit(registry, "ProofAnchored");
  });

  it("recorder 권한 회수", async () => {
    const { registry, recorder } = await loadFixture(deploy);
    await registry.setRecorder(recorder.address, true);
    await registry.setRecorder(recorder.address, false);
    await expect(registry.connect(recorder).anchor(toReportKey(REPORT_ID), hashReportBytes(REPORT)))
      .to.be.revertedWithCustomError(registry, "NotRecorder");
  });
});
