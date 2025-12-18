// config.js - MTEC Package USDT Auto-Stake (Owner Admin)

window.NETWORK = { chainIdHex: "0x38", chainIdDec: 56 }; // BSC Mainnet

window.ADDR = {
  CONTRACT: "0xaC222708698da5E9Fc75aeaaD75b29102C9bBA90",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  MTEC: "0x2D36AC3c4D4484aC60dcE5f1D4d2B69A826F52A4"
};

window.DECIMALS = { USDT: 18, MTEC: 18 };

// Minimal ERC20 ABI
window.ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// Contract ABI (เฉพาะที่ Admin ต้องใช้)
window.CONTRACT_ABI = [
  "function owner() view returns (address)",
  "function apyBasisPoints() view returns (uint256)",
  "function lockDuration() view returns (uint256)",
  "function enabled() view returns (bool)",

  "function packageCount() view returns (uint256)",
  "function packages(uint256) view returns (uint256 usdtIn, uint256 mtecOut, bool active)",

  "function setPackage(uint256 id, uint256 usdtIn, uint256 mtecOut, bool active)",
  "function setParams(uint256 _apyBP, uint256 _lockSec, bool _enabled)",
  "function setReferralRates(uint256 _ref1, uint256 _ref2, uint256 _ref3)",

  "function withdrawUSDT(uint256 amount, address to)",
  "function withdrawMTEC(uint256 amount, address to)"
];
