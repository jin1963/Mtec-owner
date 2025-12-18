let injected, provider, signer, account;
let contract, usdt, mtec;

const $ = (id) => document.getElementById(id);
const safe = (id) => {
  const el = $(id);
  return el || null;
};

function setText(id, v) {
  const el = safe(id);
  if (el) el.textContent = v ?? "";
}

function setBadge(type, text) {
  const el = safe("statusBadge");
  if (!el) return;
  el.className = "badge " + (type || "warn");
  el.textContent = text || "";
}

function setMsg(text, type) {
  const el = safe("msg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = type === "error" ? "#b00000" : type === "ok" ? "#0a7a2a" : "#0b1b33";
}

function shortAddr(a){
  if(!a) return "-";
  return a.slice(0,6) + "..." + a.slice(-4);
}

function getInjectedProvider() {
  if (window.bitget?.ethereum) return window.bitget.ethereum;
  if (window.bitkeep?.ethereum) return window.bitkeep.ethereum;
  if (window.ethereum) return window.ethereum;
  return null;
}

async function ensureBSC() {
  const net = window.NETWORK;
  if (!injected) throw new Error("No injected wallet");
  let chainId = await injected.request({ method: "eth_chainId" });
  setText("netText", `${chainId} (${parseInt(chainId,16)})`);

  if (chainId?.toLowerCase() === net.chainIdHex.toLowerCase()) return;

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net.chainIdHex }]
    });
  } catch (e) {
    if (e?.code === 4902 || String(e?.message || "").includes("4902")) {
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

function fmtUnits(bn, dec){
  try { return Number(ethers.utils.formatUnits(bn || 0, dec)).toLocaleString(undefined,{maximumFractionDigits:6}); }
  catch { return "-"; }
}

async function refreshAll(){
  if (!provider || !account) return;

  const [usdtW, mtecW] = await Promise.all([
    usdt.balanceOf(account),
    mtec.balanceOf(account)
  ]);

  const [usdtC, mtecC] = await Promise.all([
    usdt.balanceOf(window.ADDR.CONTRACT),
    mtec.balanceOf(window.ADDR.CONTRACT)
  ]);

  setText("usdtInWallet", fmtUnits(usdtW, window.DECIMALS.USDT));
  setText("mtecInWallet", fmtUnits(mtecW, window.DECIMALS.MTEC));
  setText("usdtInContract", fmtUnits(usdtC, window.DECIMALS.USDT));
  setText("mtecInContract", fmtUnits(mtecC, window.DECIMALS.MTEC));

  const [apy, lock, en] = await Promise.all([
    contract.apyBasisPoints(),
    contract.lockDuration(),
    contract.enabled()
  ]);

  const lockDays = Math.floor(Number(lock)/86400);
  setText("currentParams", `Current: APY=${apy} BPS | Lock=${lockDays} days | Enabled=${en}`);

  if (safe("inpAPY")) safe("inpAPY").value = apy.toString();
  if (safe("inpLockDays")) safe("inpLockDays").value = String(lockDays);
  if (safe("selEnabled")) safe("selEnabled").value = en ? "true" : "false";

  const [r1, r2, r3] = await Promise.all([
    contract.ref1Bps(), contract.ref2Bps(), contract.ref3Bps()
  ]);
  setText("currentRefs", `Current: Ref1=${r1} | Ref2=${r2} | Ref3=${r3}`);

  if (safe("inpRef1")) safe("inpRef1").value = r1.toString();
  if (safe("inpRef2")) safe("inpRef2").value = r2.toString();
  if (safe("inpRef3")) safe("inpRef3").value = r3.toString();

  const pc = await contract.packageCount();
  setText("pkgCount", pc.toString());

  const id = Number(safe("pkgId")?.value || 1);
  if (id > 0 && id <= Number(pc)) {
    const p = await contract.packages(id);
    setText("pkgPreview", `Package #${id} → USDT=${fmtUnits(p.usdtIn, window.DECIMALS.USDT)} | MTEC=${fmtUnits(p.mtecOut, window.DECIMALS.MTEC)} | active=${p.active}`);
  } else {
    setText("pkgPreview", "เลือก Package ID เพื่อดูรายละเอียด");
  }
}

async function txWrap(fn, okText){
  try{
    setMsg("Sending transaction...", "");
    const tx = await fn();
    setMsg("Waiting confirmation...", "");
    await tx.wait();
    setMsg(okText || "Done ✓", "ok");
    await refreshAll();
  }catch(e){
    console.error(e);
    setMsg("Tx failed: " + (e?.data?.message || e?.error?.message || e?.message || e), "error");
  }
}

async function connect(){
  try{
    setMsg("", "");
    setBadge("warn", "Connecting...");

    injected = getInjectedProvider();
    if (!injected) throw new Error("No injected wallet");

    const accounts = await injected.request({ method: "eth_requestAccounts" });
    account = accounts?.[0];
    if (!account) throw new Error("No account");

    await ensureBSC();

    provider = new ethers.providers.Web3Provider(injected, "any");
    signer = provider.getSigner();

    const net = await provider.getNetwork();
    setText("netText", String(net.chainId));
    if (net.chainId !== window.NETWORK.chainIdDec) throw new Error("Wrong network: " + net.chainId);

    setText("contractText", window.ADDR.CONTRACT);
    setText("footerContract", window.ADDR.CONTRACT);

    contract = new ethers.Contract(window.ADDR.CONTRACT, window.CONTRACT_ABI, signer);
    usdt = new ethers.Contract(window.ADDR.USDT, window.ERC20_ABI, signer);
    mtec = new ethers.Contract(window.ADDR.MTEC, window.ERC20_ABI, signer);

    const owner = await contract.owner();
    setText("ownerText", owner);
    setText("walletText", account);

    const btn = safe("btnConnect");
    if (btn) btn.textContent = shortAddr(account);

    if (owner?.toLowerCase() === account.toLowerCase()) {
      setBadge("ok", "Connected ✓ (Owner)");
      setMsg("พร้อมใช้งาน Owner Tools", "ok");
    } else {
      setBadge("warn", "Connected ✓ (Not owner)");
      setMsg("Wallet นี้ไม่ใช่ Owner ของสัญญา", "error");
    }

    if (injected.on) {
      injected.on("accountsChanged", () => location.reload());
      injected.on("chainChanged", () => location.reload());
    }

    await refreshAll();

  }catch(e){
    console.error(e);
    setBadge("bad", "Not connected");
    setMsg("Connect failed: " + (e?.message || e), "error");
  }
}

function bindUI(){
  const btnConnect = safe("btnConnect");
  if (btnConnect) btnConnect.onclick = () => connect();

  const btnRefresh = safe("btnRefresh");
  if (btnRefresh) btnRefresh.onclick = () => refreshAll();

  const btnSetParams = safe("btnSetParams");
  if (btnSetParams) btnSetParams.onclick = () => {
    const apy = Number(safe("inpAPY")?.value || 0);
    const lockDays = Number(safe("inpLockDays")?.value || 0);
    const enabled = (safe("selEnabled")?.value || "false") === "true";
    const lockSec = Math.floor(lockDays * 86400);
    txWrap(() => contract.setParams(apy, lockSec, enabled), "Params updated ✓");
  };

  const btnSetRefs = safe("btnSetRefs");
  if (btnSetRefs) btnSetRefs.onclick = () => {
    const r1 = Number(safe("inpRef1")?.value || 0);
    const r2 = Number(safe("inpRef2")?.value || 0);
    const r3 = Number(safe("inpRef3")?.value || 0);
    txWrap(() => contract.setReferralRates(r1, r2, r3), "Referral rates updated ✓");
  };

  const btnSetPkg = safe("btnSetPkg");
  if (btnSetPkg) btnSetPkg.onclick = () => {
    const id = Number(safe("pkgId")?.value || 0);
    const usdtInNum = String(safe("pkgUsdt")?.value || "0");
    const mtecOutNum = String(safe("pkgMtec")?.value || "0");
    const active = (safe("pkgActive")?.value || "false") === "true";
    const usdtIn = ethers.utils.parseUnits(usdtInNum, window.DECIMALS.USDT);
    const mtecOut = ethers.utils.parseUnits(mtecOutNum, window.DECIMALS.MTEC);
    txWrap(() => contract.setPackage(id, usdtIn, mtecOut, active), "Package updated ✓");
  };

  const btnWdUsdt = safe("btnWdUsdt");
  if (btnWdUsdt) btnWdUsdt.onclick = () => {
    const to = (safe("wdTo")?.value || "").trim();
    const amt = (safe("wdUsdt")?.value || "").trim();
    if (!ethers.utils.isAddress(to)) return setMsg("Invalid to address", "error");
    const amount = ethers.utils.parseUnits(amt, window.DECIMALS.USDT);
    txWrap(() => contract.withdrawUSDT(amount, to), "Withdraw USDT success ✓");
  };

  const btnWdMtec = safe("btnWdMtec");
  if (btnWdMtec) btnWdMtec.onclick = () => {
    const to = (safe("wdTo")?.value || "").trim();
    const amt = (safe("wdMtec")?.value || "").trim();
    if (!ethers.utils.isAddress(to)) return setMsg("Invalid to address", "error");
    const amount = ethers.utils.parseUnits(amt, window.DECIMALS.MTEC);
    txWrap(() => contract.withdrawMTEC(amount, to), "Withdraw MTEC success ✓");
  };

  const pkgId = safe("pkgId");
  if (pkgId) pkgId.addEventListener("input", () => refreshAll());

  setBadge("warn", "Not connected");
  setMsg("กด Connect Wallet เพื่อเริ่มใช้งาน", "");
  setText("contractText", window.ADDR?.CONTRACT || "-");
  setText("footerContract", window.ADDR?.CONTRACT || "-");
}

window.addEventListener("DOMContentLoaded", bindUI);
