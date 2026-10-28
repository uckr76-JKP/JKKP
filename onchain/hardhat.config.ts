import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const { AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // FORK_URL을 주면 그 체인을 로컬로 복제해 시험한다 (예: Base Sepolia, HARDHAT_CHAIN_ID=84532).
    hardhat: {
      chainId: Number(process.env.HARDHAT_CHAIN_ID) || 31337,
      ...(process.env.FORK_URL && { forking: { url: process.env.FORK_URL } }),
      chains: { 84532: { hardforkHistory: { cancun: 0 } } },
    },
    amoy: {
      url: AMOY_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com",
      chainId: 80002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
