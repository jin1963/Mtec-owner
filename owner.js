// owner.js - MTEC Admin Panel (MetaMask + Bitget fixed)

let injected;
let provider;
let signer;
let account = null;

let contract, usdt, mtec;

const $ = (id) => document.getElementById(id);

function setBadge(type, text) {
  const b = $("statusBadge");
  if (!b) return;
  b.className = "badge " + (type || "warn");
  b.textContent = text || "";
}

function setMsg(text, type) {
  const el = $("msg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = type === "error" ? "#b00000" : type === "ok" ? "#0a7a2a" : "#0b1b33";
}

function shortAddr(a){
  if(!a) return "-";
  return a.slice(0,6) + "..." + a.slice(-4);
}

function getInjectedProvider() {
  // Bitget first
  if (window.bitget && window.bitget.ethereum) return window.bitget.ethereum;
  // Bitkeep
  if (window.bitkeep && window.bitkeep.ethereum) return window.bitkeep.ethereum;
  // MetaMask / standard
  if (window.ethereum) return window.ethereum;
  return null;
}

async function ensureBSC() {
  const net = window.NETWORK;
  if (!injected) throw new Error("No injected wallet");

  // บาง wallet ส่ง chainId เพี้ยนตอนแรก → ขอใหม่อีกรอบก่อนสรุปผล
  let chainId = await injected.request({ method: "eth_chainId" });
  if (!chainId) chainId = await injected.request({ method: "eth_chainId" });

  // อัปเดต UI
  $("netText").textContent = `${chainId} (${parseInt(chainId,16)})`;

  if (chainId.toLowerCase() === net.chainIdHex.toLowerCase()) return;

  // ลอง switch ก่อน
  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net.chainIdHex }]
    });
    return;
  } catch (e) {
    // ถ้าไม่มี chain ใน wallet → add chain
    if (e && (e.code === 4902 || String(e.message || "").includes("4902"))) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: net.chainIdHex,
          chainName: net.chainName,
          rpcUrls: net.rpcUrls,
          blockExplorerUrls: net.blockExplorerUrls,
          nativeCurrency: net.nativeCurrency
        }]
      });
      return;
    }
    throw e;
  }
}

async function connect() {
  setMsg("", "");
  setBadge("warn", "Connecting...");

  injected = getInjectedProvider();
  if (!injected) {
    setBadge("bad", "No wallet");
    setMsg("ไม่พบ Wallet (MetaMask / Bitget) ในเบราว์เซอร์", "error");
    return;
  }

  // ขอ account ก่อน (บาง wallet ต้องขอก่อนถึง switch ได้)
  const accounts = await injected.request({ method: "eth_requestAccounts" });
  account = accounts && accounts[0] ? accounts[0] : null;
  if (!account) throw new Error("No account returned");

  // บังคับเป็น BSC (แก้ปัญหา Wrong network 1/0x1)
  await ensureBSC();

  provider = new ethers.providers.Web3Provider(injected, "any");
  signer = provider.getSigner();

  // ตรวจ chain อีกครั้งแบบชัวร์
  const network = await provider.getNetwork();
  $("netText").textContent = `${network.chainId}`;
  if (network.chainId !== window.NETWORK.chainIdDec) {
    throw new Error("Wrong network: " + network.chainId);
  }

  const cfgOk = window.ADDR && window.CONTRACT_ABI && window.ERC20_ABI && window.DECIMALS;
  if (!cfgOk) throw new Error("Missing config.js variables");

  $("contractText").textContent = window.ADDR.CONTRACT;
  $("footerContract").textContent = window.ADDR.CONTRACT;

  // init contracts
  contract = new ethers.Contract(window.ADDR.CONTRACT, window.CONTRACT_ABI, signer);
  usdt = new ethers.Contract(window.ADDR.USDT, window.ERC20_ABI, signer);
  mtec = new ethers.Contract(window.ADDR.MTEC, window.ERC20_ABI, signer);

  // owner check
  const owner = await contract.owner();
  $("ownerText").textContent = owner;

  $("walletText").textContent = account;

  // ปุ่ม connect เปลี่ยนเป็น address สั้น
  $("btnConnect").textContent = shortAddr(account);

  // status badge
  if (owner && owner.toLowerCase() === account.toLowerCase()) {
    setBadge("ok", "Connected ✓ (Owner)");
  } else {
    setBadge("warn", "Connected ✓ (Not owner)");
    setMsg("คำเตือน: wallet ที่เชื่อมต่อไม่ใช่ owner ของสัญญา (จะกดปุ่ม owner ไม่ได้)", "");
  }

  // listeners
  if (injected.on) {
    injected.on("accountsChanged", () => window.location.reload());
    injected.on("chainChanged", () => window.location.reload());
  }

  await refreshAll();
}

function fmtUnits(bn, dec){
  try { return Number(ethers.utils.formatUnits(bn || 0, dec)).toLocaleString(undefined,{maximumFractionDigits:6}); }
  catch { return "-"; }
}

async function refreshAll(){
  if (!provider || !account) return;

  // balances
  const [usdtW, mtecW] = await Promise.all([
    usdt.balanceOf(account),
    mtec.balanceOf(account)
  ]);

  const [usdtC, mtecC] = await Promise.all([
    usdt.balanceOf(window.ADDR.CONTRACT),
    mtec.balanceOf(window.ADDR.CONTRACT)
  ]);

  $("usdtInWallet").textContent = fmtUnits(usdtW, window.DECIMALS.USDT);
  $("mtecInWallet").textContent = fmtUnits(mtecW, window.DECIMALS.MTEC);
  $("usdtInContract").textContent = fmtUnits(usdtC, window.DECIMALS.USDT);
  $("mtecInContract").textContent = fmtUnits(mtecC, window.DECIMALS.MTEC);

  // params
  const [apy, lock, en] = await Promise.all([
    contract.apyBasisPoints(),
    contract.lockDuration(),
    contract.enabled()
  ]);

  $("currentParams").textContent = `Current: APY=${apy.toString()} BPS | Lock=${Math.floor(Number(lock)/86400)} days | Enabled=${en}`;

  $("inpAPY").value = apy.toString();
  $("inpLockDays").value = String(Math.floor(Number(lock)/86400));
  $("selEnabled").value = en ? "true" : "false";

  // refs
  const [r1, r2, r3] = await Promise.all([
    contract.ref1Bps(),
    contract.ref2Bps(),
    contract.ref3Bps()
  ]);

  $("currentRefs").textContent = `Current: Ref1=${r1} | Ref2=${r2} | Ref3=${r3}`;
  $("inpRef1").value = r1.toString();
  $("inpRef2").value = r2.toString();
  $("inpRef3").value = r3.toString();

  // packages
  const pc = await contract.packageCount();
  $("pkgCount").textContent = pc.toString();

  // preview selected package
  const id = Number($("pkgId").value || 1);
  if (id > 0 && id <= Number(pc)) {
    const p = await contract.packages(id);
    const usdtIn = fmtUnits(p.usdtIn, window.DECIMALS.USDT);
    const mtecOut = fmtUnits(p.mtecOut, window.DECIMALS.MTEC);
    $("pkgPreview").textContent = `Package #${id} → USDT=${usdtIn} | MTEC=${mtecOut} | active=${p.active}`;
  } else {
    $("pkgPreview").textContent = "เลือก Package ID เพื่อดูรายละเอียด";
  }
}

async function txWrap(fn, okText){
  try{
    setMsg("Sending transaction...", "");
    const tx = await fn();
    if (!tx || !tx.hash) throw new Error("Wallet did not return tx");
    setMsg("Waiting confirmation: " + tx.hash, "");
    await tx.wait();
    setMsg(okText || "Done ✓", "ok");
    await refreshAll();
  }catch(e){
    console.error(e);
    setMsg("Tx failed: " + (e?.data?.message || e?.error?.message || e?.message || e), "error");
  }
}

async function onSetParams(){
  if (!contract) return;
  const apy = Number($("inpAPY").value || 0);
  const lockDays = Number($("inpLockDays").value || 0);
  const enabled = $("selEnabled").value === "true";
  const lockSec = Math.floor(lockDays * 86400);

  await txWrap(() => contract.setParams(apy, lockSec, enabled), "Params updated ✓");
}

async function onSetRefs(){
  if (!contract) return;
  const r1 = Number($("inpRef1").value || 0);
  const r2 = Number($("inpRef2").value || 0);
  const r3 = Number($("inpRef3").value || 0);

  await txWrap(() => contract.setReferralRates(r1, r2, r3), "Referral rates updated ✓");
}

async function onSetPackage(){
  if (!contract) return;

  const id = Number($("pkgId").value || 0);
  const usdtInNum = String($("pkgUsdt").value || "0");
  const mtecOutNum = String($("pkgMtec").value || "0");
  const active = $("pkgActive").value === "true";

  if (!id || id <= 0) { setMsg("Invalid package id", "error"); return; }

  const usdtIn = ethers.utils.parseUnits(usdtInNum, window.DECIMALS.USDT);
  const mtecOut = ethers.utils.parseUnits(mtecOutNum, window.DECIMALS.MTEC);

  await txWrap(() => contract.setPackage(id, usdtIn, mtecOut, active), "Package updated ✓");
}

async function onWithdrawUSDT(){
  if (!contract) return;
  const to = $("wdTo").value.trim();
  const amt = $("wdUsdt").value.trim();

  if (!ethers.utils.isAddress(to)) { setMsg("Invalid to address", "error"); return; }
  if (!amt || Number(amt) <= 0) { setMsg("Invalid amount", "error"); return; }

  const amount = ethers.utils.parseUnits(amt, window.DECIMALS.USDT);
  await txWrap(() => contract.withdrawUSDT(amount, to), "Withdraw USDT success ✓");
}

async function onWithdrawMTEC(){
  if (!contract) return;
  const to = $("wdTo").value.trim();
  const amt = $("wdMtec").value.trim();

  if (!ethers.utils.isAddress(to)) { setMsg("Invalid to address", "error"); return; }
  if (!amt || Number(amt) <= 0) { setMsg("Invalid amount", "error"); return; }

  const amount = ethers.utils.parseUnits(amt, window.DECIMALS.MTEC);
  await txWrap(() => contract.withdrawMTEC(amount, to), "Withdraw MTEC success ✓");
}

function bindUI(){
  $("contractText").textContent = window.ADDR?.CONTRACT || "-";
  $("footerContract").textContent = window.ADDR?.CONTRACT || "-";

  $("btnConnect").onclick = () => connect();
  $("btnRefresh").onclick = () => refreshAll();

  $("btnSetParams").onclick = () => onSetParams();
  $("btnSetRefs").onclick = () => onSetRefs();
  $("btnSetPkg").onclick = () => onSetPackage();

  $("btnWdUsdt").onclick = () => onWithdrawUSDT();
  $("btnWdMtec").onclick = () => onWithdrawMTEC();

  $("pkgId").addEventListener("input", () => refreshAll());
}

window.addEventListener("load", () => {
  try{
    bindUI();
    setBadge("warn", "Not connected");
    setMsg("กด Connect Wallet เพื่อเริ่มใช้งาน", "");
    // ไม่ auto-connect เพื่อกัน wallet บางตัวค้าง “already pending”
  }catch(e){
    console.error(e);
    setMsg("Init error: " + (e.message || e), "error");
  }
});
