import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const registry = await ethers.deployContract("SettlementProofRegistry");
  await registry.waitForDeployment();

  console.log(`network:  ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`registry: ${await registry.getAddress()}`);
  console.log("→ .env의 REGISTRY_ADDRESS에 위 주소를 넣으세요.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
