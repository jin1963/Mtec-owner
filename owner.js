(() => {
  const $ = (id) => document.getElementById(id);
  const short = (a) => (a ? a.slice(0,6)+"..."+a.slice(-4) : "-");
  const setOMsg = (t, type="") => {
    const el = $("oMsg");
    if (!el) return;
    el.className = "msg " + type;
    el.textContent = t || "";
  };

  let provider, web3Provider, signer, addr;
  let c, usdt, mtec;
  let connectPending = false;
  let switchPending = false;

  function ensureConfig() {
    const ok =
      window.ADDR && window.DECIMALS &&
      window.ERC20_ABI && window.CONTRACT_ABI &&
      window.NETWORK;
    if (!ok) throw new Error("Missing config.js variables");
  }

  async function readChain() {
    try {
      const cid = await provider.request({ method: "eth_chainId" });
      return parseInt(cid, 16);
    } catch { return null; }
  }

  async function updateWarn(text, show=true) {
    const w = $("oWarn");
    if (!w) return;
    if (!show) { w.style.display="none"; w.textContent=""; return; }
    w.style.display="block";
    w.textContent = text;
  }

  async function trySwitchToBSC() {
    const cid = await readChain();
    $("oChain").textContent = cid ? String(cid) : "-";
    if (cid === window.NETWORK.chainIdDec) { await updateWarn("", false); return true; }

    // ไม่ spam request
    if (switchPending) return false;
    switchPending = true;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: window.NETWORK.chainIdHex }],
      });
      await updateWarn("", false);
      return true;
    } catch (e) {
      if (e && e.code === -32002) {
        await updateWarn("มีคำขอสลับเครือข่ายค้างอยู่ใน MetaMask กรุณาเปิด MetaMask แล้วยืนยัน/ยกเลิกก่อน");
        return false;
      }
      await updateWarn("กรุณาเลือก BSC Mainnet (chainId 56) ใน MetaMask");
      return false;
    } finally {
      switchPending = false;
      const cid2 = await readChain();
      $("oChain").textContent = cid2 ? String(cid2) : "-";
    }
  }

  async function build() {
    web3Provider = new ethers.providers.Web3Provider(provider, "any");
    signer = web3Provider.getSigner();
    c = new ethers.Contract(window.ADDR.CONTRACT, window.CONTRACT_ABI, signer);
    usdt = new ethers.Contract(window.ADDR.USDT, window.ERC20_ABI, signer);
    mtec = new ethers.Contract(window.ADDR.MTEC, window.ERC20_ABI, signer);
  }

  async function refresh() {
    try {
      if (!c) return;
      setOMsg("");

      const owner = await c.owner();
      $("oOwner").textContent = owner;
      $("oContract").textContent = window.ADDR.CONTRACT;
      $("oContract2").textContent = window.ADDR.CONTRACT;

      // แสดงค่าปัจจุบัน
      const apy = await c.apyBasisPoints();
      const lock = await c.lockDuration();
      const en = await c.enabled();

      $("inApy").value = apy.toString();
      $("inLockDays").value = Math.floor(Number(lock.toString()) / 86400).toString();
      $("inEnabled").value = en ? "true" : "false";

      const r1 = await c.ref1Bps();
      const r2 = await c.ref2Bps();
      const r3 = await c.ref3Bps();
      $("inRef1").value = r1.toString();
      $("inRef2").value = r2.toString();
      $("inRef3").value = r3.toString();

      // owner check
      if (addr && owner && addr.toLowerCase() !== owner.toLowerCase()) {
        await updateWarn("Wallet นี้ไม่ใช่ Owner ของสัญญา", true);
      } else {
        const cid = await readChain();
        if (cid === window.NETWORK.chainIdDec) await updateWarn("", false);
      }
    } catch (e) {
      console.log(e);
      setOMsg(e?.message || String(e), "err");
    }
  }

  async function connectMetaMask() {
    try {
      ensureConfig();

      if (!window.ethereum) {
        setOMsg("ไม่พบ MetaMask", "err");
        return;
      }

      // เจาะจง MetaMask เท่านั้น
      if (!window.ethereum.isMetaMask) {
        setOMsg("Owner panel ใช้ได้เฉพาะ MetaMask เท่านั้น", "err");
        return;
      }

      provider = window.ethereum;

      if (connectPending) return;
      connectPending = true;

      let accounts;
      try {
        accounts = await provider.request({ method: "eth_requestAccounts" });
      } catch (e) {
        if (e && e.code === -32002) {
          setOMsg("มีคำขอเชื่อมต่อค้างอยู่ใน MetaMask กรุณาเปิด MetaMask แล้วยืนยัน/ยกเลิกก่อน", "warn");
          return;
        }
        throw e;
      }

      addr = ethers.utils.getAddress(accounts[0]);
      $("oWallet").textContent = addr;
      $("btnConnectOwner").textContent = short(addr);
      $("oContract").textContent = window.ADDR.CONTRACT;
      $("oContract2").textContent = window.ADDR.CONTRACT;

      const ok = await trySwitchToBSC();
      if (!ok) return;

      await build();
      await refresh();
      setOMsg("Connected ✓", "ok");

      provider.on?.("accountsChanged", () => window.location.reload());
      provider.on?.("chainChanged", () => window.location.reload());

    } catch (e) {
      console.log(e);
      setOMsg(`Connect failed: ${e?.message || e}`, "err");
    } finally {
      connectPending = false;
    }
  }

  function onlyOwnerGuard() {
    return async () => {
      const owner = await c.owner();
      if (!addr || addr.toLowerCase() !== owner.toLowerCase()) {
        throw new Error("Wallet นี้ไม่ใช่ Owner");
      }
    };
  }

  async function setParams() {
    try {
      setOMsg("");
      if (!c) return setOMsg("กรุณา Connect MetaMask ก่อน", "warn");
      await (await onlyOwnerGuard())();

      const apy = Number($("inApy").value || "0");
      const lockDays = Number($("inLockDays").value || "0");
      const enabled = $("inEnabled").value === "true";
      const lockSec = Math.floor(lockDays * 86400);

      const tx = await c.setParams(apy, lockSec, enabled);
      setOMsg("กำลังส่งธุรกรรม setParams...", "warn");
      await tx.wait();
      setOMsg("ตั้งค่า Params สำเร็จ ✓", "ok");
      await refresh();
    } catch (e) {
      console.log(e);
      setOMsg(e?.data?.message || e?.message || String(e), "err");
    }
  }

  async function setRefs() {
    try {
      setOMsg("");
      if (!c) return setOMsg("กรุณา Connect MetaMask ก่อน", "warn");
      await (await onlyOwnerGuard())();

      const r1 = Number($("inRef1").value || "0");
      const r2 = Number($("inRef2").value || "0");
      const r3 = Number($("inRef3").value || "0");

      const tx = await c.setReferralRates(r1, r2, r3);
      setOMsg("กำลังส่งธุรกรรม setReferralRates...", "warn");
      await tx.wait();
      setOMsg("ตั้งค่า Referral สำเร็จ ✓", "ok");
      await refresh();
    } catch (e) {
      console.log(e);
      setOMsg(e?.data?.message || e?.message || String(e), "err");
    }
  }

  async function setPackage() {
    try {
      setOMsg("");
      if (!c) return setOMsg("กรุณา Connect MetaMask ก่อน", "warn");
      await (await onlyOwnerGuard())();

      const id = Number($("inPkgId").value || "0");
      const active = $("inPkgActive").value === "true";
      const usdtHuman = $("inPkgUsdt").value || "0";
      const mtecHuman = $("inPkgMtec").value || "0";

      const usdtIn = ethers.utils.parseUnits(usdtHuman, window.DECIMALS.USDT);
      const mtecOut = ethers.utils.parseUnits(mtecHuman, window.DECIMALS.MTEC);

      const tx = await c.setPackage(id, usdtIn, mtecOut, active);
      setOMsg("กำลังส่งธุรกรรม setPackage...", "warn");
      await tx.wait();
      setOMsg("ตั้งค่าแพ็คเกจสำเร็จ ✓", "ok");
    } catch (e) {
      console.log(e);
      setOMsg(e?.data?.message || e?.message || String(e), "err");
    }
  }

  async function withdrawUSDT() {
    try {
      setOMsg("");
      if (!c) return setOMsg("กรุณา Connect MetaMask ก่อน", "warn");
      await (await onlyOwnerGuard())();

      const amtHuman = $("inWUsdt").value || "0";
      const to = $("inWTo1").value || "";
      if (!ethers.utils.isAddress(to)) throw new Error("ที่อยู่ to ไม่ถูกต้อง");

      const amt = ethers.utils.parseUnits(amtHuman, window.DECIMALS.USDT);
      const tx = await c.withdrawUSDT(amt, to);
      setOMsg("กำลังส่งธุรกรรม withdrawUSDT...", "warn");
      await tx.wait();
      setOMsg("Withdraw USDT สำเร็จ ✓", "ok");
    } catch (e) {
      console.log(e);
      setOMsg(e?.data?.message || e?.message || String(e), "err");
    }
  }

  async function withdrawMTEC() {
    try {
      setOMsg("");
      if (!c) return setOMsg("กรุณา Connect MetaMask ก่อน", "warn");
      await (await onlyOwnerGuard())();

      const amtHuman = $("inWMtec").value || "0";
      const to = $("inWTo2").value || "";
      if (!ethers.utils.isAddress(to)) throw new Error("ที่อยู่ to ไม่ถูกต้อง");

      const amt = ethers.utils.parseUnits(amtHuman, window.DECIMALS.MTEC);
      const tx = await c.withdrawMTEC(amt, to);
      setOMsg("กำลังส่งธุรกรรม withdrawMTEC...", "warn");
      await tx.wait();
      setOMsg("Withdraw MTEC สำเร็จ ✓", "ok");
    } catch (e) {
      console.log(e);
      setOMsg(e?.data?.message || e?.message || String(e), "err");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      ensureConfig();
      $("oContract").textContent = window.ADDR.CONTRACT;
      $("oContract2").textContent = window.ADDR.CONTRACT;

      $("btnConnectOwner")?.addEventListener("click", connectMetaMask);
      $("btnSetParams")?.addEventListener("click", setParams);
      $("btnSetRefs")?.addEventListener("click", setRefs);
      $("btnSetPkg")?.addEventListener("click", setPackage);
      $("btnWithdrawUSDT")?.addEventListener("click", withdrawUSDT);
      $("btnWithdrawMTEC")?.addEventListener("click", withdrawMTEC);
      $("btnRefresh")?.addEventListener("click", refresh);

      // แสดง chain ทันที (ไม่ alert วน)
      if (window.ethereum?.isMetaMask) {
        provider = window.ethereum;
        const cid = await readChain();
        $("oChain").textContent = cid ? String(cid) : "-";
        if (cid && cid !== window.NETWORK.chainIdDec) {
          await updateWarn("กรุณาเลือก BSC Mainnet (chainId 56) ใน MetaMask", true);
        }
      }
    } catch (e) {
      console.log(e);
      setOMsg(e?.message || String(e), "err");
    }
  });
})();
