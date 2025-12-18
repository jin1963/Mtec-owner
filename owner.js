// owner.js - MTEC Admin Panel (Bitget + MetaMask) - ethers v5

let injected, provider, signer, account = null;
let contract, usdt, mtec;

const ZERO = "0x0000000000000000000000000000000000000000";

function $(id){ return document.getElementById(id); }

function setMsg(text, type="info"){
  const el = $("txMessage");
  if(!el) return;
  el.textContent = text || "";
  if(type==="success") el.style.color = "#16a34a";
  else if(type==="error") el.style.color = "#dc2626";
  else el.style.color = "#0f172a";
}

function shortAddr(a){
  if(!a) return "-";
  return a.slice(0,6)+"..."+a.slice(-4);
}

function getInjectedProvider(){
  if (window.bitget && window.bitget.ethereum) return window.bitget.ethereum;
  if (window.bitkeep && window.bitkeep.ethereum) return window.bitkeep.ethereum;
  if (window.ethereum) return window.ethereum;
  return null;
}

async function connectWallet(){
  try{
    setMsg("", "info");
    injected = getInjectedProvider();
    if(!injected){
      alert("ไม่พบ Wallet (Bitget/MetaMask) ในเบราว์เซอร์");
      return;
    }

    provider = new ethers.providers.Web3Provider(injected, "any");

    const accounts = await injected.request({ method: "eth_requestAccounts" });
    if(!accounts || !accounts.length) throw new Error("No account");
    account = accounts[0];

    const net = await provider.getNetwork();
    $("netLabel").textContent = `chainId ${net.chainId}`;

    // บาง wallet รายงาน chainId เพี้ยนชั่วคราวตอนยังไม่พร้อม => เช็คซ้ำอีกที
    if(net.chainId !== window.NETWORK.chainIdDec){
      // ลองอ่านจาก ethereum.chainId (hex) อีกทาง
      let hex = null;
      try { hex = await injected.request({ method: "eth_chainId" }); } catch(e){}
      if(hex !== window.NETWORK.chainIdHex){
        alert("กรุณาเลือก BSC Mainnet (chainId 56) ใน Wallet ก่อน");
        throw new Error("Wrong network: " + net.chainId + " / " + hex);
      }
    }

    signer = provider.getSigner();

    const cfg = window.ADDR;
    contract = new ethers.Contract(cfg.CONTRACT, window.CONTRACT_ABI, signer);
    usdt = new ethers.Contract(cfg.USDT, window.ERC20_ABI, signer);
    mtec = new ethers.Contract(cfg.MTEC, window.ERC20_ABI, signer);

    $("walletLabel").textContent = account;
    $("contractLabel").textContent = cfg.CONTRACT;

    const owner = await contract.owner();
    $("ownerLabel").textContent = owner;

    if($("btnConnect")){
      $("btnConnect").textContent = shortAddr(account);
    }

    // Owner gate
    const isOwner = owner && account && owner.toLowerCase() === account.toLowerCase();
    $("ownerStatus").textContent = isOwner ? "Owner ✓" : "Not Owner ✗ (ปุ่มจะถูกล็อก)";
    $("ownerStatus").style.background = isOwner ? "#ecfdf5" : "#fff1f2";
    $("ownerStatus").style.borderColor = isOwner ? "#bbf7d0" : "#fecdd3";
    $("ownerStatus").style.color = isOwner ? "#065f46" : "#9f1239";

    lockOwnerButtons(!isOwner);

    await refreshAll();

    if(injected && injected.on){
      injected.on("accountsChanged", ()=>window.location.reload());
      injected.on("chainChanged", ()=>window.location.reload());
    }

    setMsg("Connected ✓", "success");
  }catch(err){
    console.error(err);
    setMsg(err?.message || String(err), "error");
  }
}

function lockOwnerButtons(lock){
  const ids = [
    "btnSetParams","btnSetRef","btnSetPkg","btnWdUsdt","btnWdMtec"
  ];
  ids.forEach(id=>{
    const el = $(id);
    if(el) el.disabled = !!lock;
    if(el) el.style.opacity = lock ? 0.5 : 1;
    if(el) el.style.cursor = lock ? "not-allowed" : "pointer";
  });
}

function fmt18(bn){
  try{ return ethers.utils.formatUnits(bn, 18); } catch(e){ return "-"; }
}

async function refreshAll(){
  if(!contract || !account) return;

  // balances
  const cfg = window.ADDR;
  const [buC, bmC, buW, bmW] = await Promise.all([
    usdt.balanceOf(cfg.CONTRACT),
    mtec.balanceOf(cfg.CONTRACT),
    usdt.balanceOf(account),
    mtec.balanceOf(account),
  ]);

  $("balUsdtContract").textContent = fmt18(buC);
  $("balMtecContract").textContent = fmt18(bmC);
  $("balUsdtWallet").textContent = fmt18(buW);
  $("balMtecWallet").textContent = fmt18(bmW);

  // params
  const [apy, lockSec, en] = await Promise.all([
    contract.apyBasisPoints(),
    contract.lockDuration(),
    contract.enabled()
  ]);
  const lockDays = Math.floor(lockSec.toNumber()/86400);
  $("currentParams").textContent = `Current: APY ${apy.toString()} BPS • Lock ${lockDays} days • enabled ${en}`;

  // packages
  await loadPackages();
}

async function loadPackages(){
  if(!contract) return;
  const tbody = $("pkgTable");
  if(!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" class="muted">Loading...</td></tr>`;

  const count = await contract.packageCount();
  const n = count.toNumber();

  if(n === 0){
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No packages yet</td></tr>`;
    return;
  }

  let rows = "";
  for(let i=1;i<=n;i++){
    const p = await contract.packages(i);
    rows += `
      <tr>
        <td>${i}</td>
        <td class="mono">${ethers.utils.formatUnits(p.usdtIn, 18)}</td>
        <td class="mono">${ethers.utils.formatUnits(p.mtecOut, 18)}</td>
        <td>${p.active}</td>
      </tr>
    `;
  }
  tbody.innerHTML = rows;
}

async function onSetParams(){
  try{
    setMsg("", "info");
    if(!contract) return;

    const apy = ($("apyBps").value || "").trim();
    const days = ($("lockDays").value || "").trim();
    const enabled = ($("enabledSel").value || "true") === "true";

    if(!apy || isNaN(Number(apy))) throw new Error("APY BPS ไม่ถูกต้อง");
    if(!days || isNaN(Number(days))) throw new Error("Lock days ไม่ถูกต้อง");

    const lockSec = ethers.BigNumber.from(Math.floor(Number(days)*86400));

    setMsg("Sending transaction: setParams...", "info");
    const tx = await contract.setParams(
      ethers.BigNumber.from(apy),
      lockSec,
      enabled
    );
    await tx.wait();
    setMsg("Updated params ✓", "success");
    await refreshAll();
  }catch(err){
    console.error(err);
    setMsg(err?.data?.message || err?.reason || err?.message || String(err), "error");
  }
}

async function onSetRef(){
  try{
    setMsg("", "info");
    if(!contract) return;

    const r1 = ($("ref1").value || "").trim();
    const r2 = ($("ref2").value || "").trim();
    const r3 = ($("ref3").value || "").trim();

    if([r1,r2,r3].some(x=>!x || isNaN(Number(x)))) throw new Error("Ref BPS ไม่ถูกต้อง");

    setMsg("Sending transaction: setReferralRates...", "info");
    const tx = await contract.setReferralRates(
      ethers.BigNumber.from(r1),
      ethers.BigNumber.from(r2),
      ethers.BigNumber.from(r3)
    );
    await tx.wait();

    setMsg("Updated referral rates ✓", "success");
  }catch(err){
    console.error(err);
    setMsg(err?.data?.message || err?.reason || err?.message || String(err), "error");
  }
}

async function onSetPackage(){
  try{
    setMsg("", "info");
    if(!contract) return;

    const id = ($("pkgId").value || "").trim();
    const usdtHuman = ($("pkgUsdt").value || "").trim();
    const mtecHuman = ($("pkgMtec").value || "").trim();
    const active = ($("pkgActive").value || "true") === "true";

    if(!id || isNaN(Number(id))) throw new Error("Package ID ไม่ถูกต้อง");
    if(!usdtHuman || Number(usdtHuman) <= 0) throw new Error("USDT In ไม่ถูกต้อง");
    if(!mtecHuman || Number(mtecHuman) <= 0) throw new Error("MTEC Out ไม่ถูกต้อง");

    const usdtWei = ethers.utils.parseUnits(usdtHuman, 18);
    const mtecWei = ethers.utils.parseUnits(mtecHuman, 18);

    setMsg("Sending transaction: setPackage...", "info");
    const tx = await contract.setPackage(
      ethers.BigNumber.from(id),
      usdtWei,
      mtecWei,
      active
    );
    await tx.wait();

    setMsg("Saved package ✓", "success");
    await refreshAll();
  }catch(err){
    console.error(err);
    setMsg(err?.data?.message || err?.reason || err?.message || String(err), "error");
  }
}

async function onWithdrawUSDT(){
  try{
    setMsg("", "info");
    if(!contract) return;

    const to = ($("wdTo").value || "").trim();
    const amt = ($("wdUsdt").value || "").trim();

    if(!to || !ethers.utils.isAddress(to)) throw new Error("To address ไม่ถูกต้อง");
    if(!amt || Number(amt) <= 0) throw new Error("Amount USDT ไม่ถูกต้อง");

    const wei = ethers.utils.parseUnits(amt, 18);

    setMsg("Sending transaction: withdrawUSDT...", "info");
    const tx = await contract.withdrawUSDT(wei, to);
    await tx.wait();

    setMsg("Withdraw USDT ✓", "success");
    await refreshAll();
  }catch(err){
    console.error(err);
    setMsg(err?.data?.message || err?.reason || err?.message || String(err), "error");
  }
}

async function onWithdrawMTEC(){
  try{
    setMsg("", "info");
    if(!contract) return;

    const to = ($("wdTo").value || "").trim();
    const amt = ($("wdMtec").value || "").trim();

    if(!to || !ethers.utils.isAddress(to)) throw new Error("To address ไม่ถูกต้อง");
    if(!amt || Number(amt) <= 0) throw new Error("Amount MTEC ไม่ถูกต้อง");

    const wei = ethers.utils.parseUnits(amt, 18);

    setMsg("Sending transaction: withdrawMTEC...", "info");
    const tx = await contract.withdrawMTEC(wei, to);
    await tx.wait();

    setMsg("Withdraw MTEC ✓", "success");
    await refreshAll();
  }catch(err){
    console.error(err);
    setMsg(err?.data?.message || err?.reason || err?.message || String(err), "error");
  }
}

window.addEventListener("load", ()=>{
  $("btnConnect").onclick = connectWallet;
  $("btnRefresh").onclick = refreshAll;

  $("btnSetParams").onclick = onSetParams;
  $("btnSetRef").onclick = onSetRef;
  $("btnSetPkg").onclick = onSetPackage;
  $("btnLoadPkgs").onclick = loadPackages;

  $("btnWdUsdt").onclick = onWithdrawUSDT;
  $("btnWdMtec").onclick = onWithdrawMTEC;

  // default labels
  $("contractLabel").textContent = window.ADDR?.CONTRACT || "-";
});
