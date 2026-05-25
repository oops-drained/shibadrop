/**
 * $SHIB Loyalty Airdrop — wallet connect + on-chain eligibility
 */

const SHIB_CONTRACT = '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE';
const SHIB_DEPLOY_BLOCK = 10_569_000;
const MIN_BALANCE = 10_000n;
const MIN_HOLD_DAYS = 180;
const ETH_MAINNET_CHAIN_ID = 1n;

/** Set claim contract address when the airdrop contract is deployed. */
const AIRDROP_CLAIM_CONTRACT = '';
const AIRDROP_CLAIM_ABI = ['function claim()'];

const READ_RPC_URLS = [
  'https://eth.llamarpc.com',
  'https://ethereum.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
];

const ELIGIBILITY_CACHE_TTL_MS = 10 * 60 * 1000;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

let walletEip1193 = null;
let provider = null;
let readProvider = null;
let signer = null;
let userAddress = null;
let lastEligibility = null;
let checkRunId = 0;

const discoveredWallets = new Map();

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const verifyBtn = document.getElementById('verifyBtn');
const copyContractBtn = document.getElementById('copyContract');
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
const walletModal = document.getElementById('walletModal');
const walletList = document.getElementById('walletList');
const walletModalClose = document.getElementById('walletModalClose');

const claimDisconnected = document.getElementById('claimDisconnected');
const claimConnected = document.getElementById('claimConnected');
const networkBadge = document.getElementById('networkBadge');
const walletAddressEl = document.getElementById('walletAddress');
const verificationStatus = document.getElementById('verificationStatus');
const verificationResults = document.getElementById('verificationResults');
const loadingState = document.getElementById('loadingState');
const loadingText = document.getElementById('loadingText');
const loadingSub = document.querySelector('.loading-sub');
const claimError = document.getElementById('claimError');
const resultFinal = document.getElementById('resultFinal');
const resultBalanceEl = document.getElementById('resultBalance');
const resultBalanceCheckEl = document.getElementById('resultBalanceCheck');
const resultFirstTxEl = document.getElementById('resultFirstTx');
const resultHoldCheckEl = document.getElementById('resultHoldCheck');
const claimBtn = document.getElementById('claimBtn');
const claimSoonNote = document.getElementById('claimSoonNote');
const mobileWalletHelp = document.getElementById('mobileWalletHelp');
const openMetaMaskBtn = document.getElementById('openMetaMaskBtn');
const openCoinbaseBtn = document.getElementById('openCoinbaseBtn');

const HEADER_SCROLL_OFFSET = 80;
const IS_MOBILE = isMobileDevice();
let screenWakeLock = null;

initWalletDiscovery();
bindUiEvents();
initAnchorNavigation();
initMobileWalletLinks();

function isMobileDevice() {
  return window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)').matches;
}

function hasInjectedWallet() {
  return Boolean(window.ethereum);
}

function getDappUrl() {
  return window.location.href.split('#')[0];
}

function initMobileWalletLinks() {
  const dappUrl = encodeURIComponent(getDappUrl());
  if (openMetaMaskBtn) {
    openMetaMaskBtn.href = `https://metamask.app.link/dapp/${dappUrl}`;
  }
  if (openCoinbaseBtn) {
    openCoinbaseBtn.href = `https://go.cb-w.com/dapp?cb_url=${dappUrl}`;
  }
}

function updateMobileWalletHelp() {
  if (!mobileWalletHelp) return;
  const show = IS_MOBILE && !hasInjectedWallet();
  mobileWalletHelp.classList.toggle('hidden', !show);
}

async function waitForWalletDiscovery(ms = 400) {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireScreenWakeLock() {
  if (!IS_MOBILE || !('wakeLock' in navigator)) return;
  try {
    screenWakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* wake lock optional */
  }
}

async function releaseScreenWakeLock() {
  try {
    await screenWakeLock?.release();
  } catch {
    /* ignore */
  }
  screenWakeLock = null;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollToHash(hash, { updateHistory = true } = {}) {
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';

  if (!hash || hash === '#' || hash === '#top') {
    window.scrollTo({ top: 0, left: 0, behavior });
    if (updateHistory) {
      history.pushState(null, '', hash === '#' ? `${window.location.pathname}${window.location.search}` : '#top');
    }
    return;
  }

  const target = document.querySelector(hash);
  if (!target) return;

  const top = target.getBoundingClientRect().top + window.scrollY - HEADER_SCROLL_OFFSET;
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior });
  if (updateHistory) history.pushState(null, '', hash);
}

function initAnchorNavigation() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const hash = link.getAttribute('href');
      if (!hash) return;

      const isTop = hash === '#top';
      const target = isTop ? document.getElementById('top') : document.querySelector(hash);
      if (!target) return;

      event.preventDefault();
      scrollToHash(hash);
      mobileNav?.classList.remove('open');
      document.body.classList.remove('mobile-nav-open');
    });
  });

  window.addEventListener('hashchange', () => {
    scrollToHash(window.location.hash, { updateHistory: false });
  });

  if (window.location.hash) {
    const hash = window.location.hash;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      scrollToHash(hash, { updateHistory: false });
    });
  }
}

function initWalletDiscovery() {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider: eip1193 } = event.detail;
    if (info?.uuid && eip1193) {
      discoveredWallets.set(info.uuid, { info, provider: eip1193 });
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function bindUiEvents() {
  menuToggle?.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    document.body.classList.toggle('mobile-nav-open', isOpen);
  });

  copyContractBtn?.addEventListener('click', copyContractAddress);
  connectBtn?.addEventListener('click', openWalletPicker);
  disconnectBtn?.addEventListener('click', disconnectWallet);
  verifyBtn?.addEventListener('click', () => runEligibilityCheck());
  walletModalClose?.addEventListener('click', closeWalletModal);
  walletModal?.addEventListener('click', (e) => {
    if (e.target === walletModal) closeWalletModal();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !loadingState.classList.contains('hidden')) {
      acquireScreenWakeLock();
    }
  });

  updateMobileWalletHelp();
}

async function copyContractAddress() {
  try {
    await navigator.clipboard.writeText(SHIB_CONTRACT);
    copyContractBtn.innerHTML = '✓';
    setTimeout(() => {
      copyContractBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    }, 2000);
  } catch {
    /* clipboard blocked */
  }
}

function shortenAddress(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatShibBalance(raw, decimals) {
  const formatted = ethers.formatUnits(raw, decimals);
  const num = parseFloat(formatted);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function normalizeAddress(address) {
  return ethers.getAddress(address);
}

function hideClaimButton() {
  claimBtn?.classList.add('hidden');
  claimBtn && (claimBtn.disabled = false);
  claimSoonNote?.classList.add('hidden');
}

function showClaimButton() {
  claimBtn?.classList.remove('hidden');
  claimBtn?.removeAttribute('disabled');
  claimBtn?.removeAttribute('aria-disabled');

  if (AIRDROP_CLAIM_CONTRACT) {
    claimSoonNote?.classList.remove('hidden');
    if (claimSoonNote) {
      claimSoonNote.textContent = 'Sign the claim transaction in your wallet. Gas fees apply.';
    }
    return;
  }

  claimSoonNote?.classList.add('hidden');
}

function setClaimError(message) {
  if (!claimError) return;
  if (!message) {
    claimError.classList.add('hidden');
    claimError.textContent = '';
    return;
  }
  claimError.textContent = message;
  claimError.classList.remove('hidden');
}

function resetVerification() {
  lastEligibility = null;
  verificationResults.classList.add('hidden');
  loadingState.classList.add('hidden');
  verificationStatus.classList.remove('hidden');
  verifyBtn.disabled = false;
  verifyBtn.textContent = 'Run Eligibility Check';
  hideClaimButton();
  setClaimError('');
  resultFinal.className = 'result-final';
  resultFinal.innerHTML = '';
  resultBalanceEl.textContent = '—';
  resultBalanceCheckEl.textContent = '—';
  resultBalanceCheckEl.className = 'result-badge';
  resultFirstTxEl.textContent = '—';
  resultHoldCheckEl.textContent = '—';
  resultHoldCheckEl.className = 'result-badge';
  try {
    if (userAddress) sessionStorage.removeItem(getHoldCacheKey(userAddress));
  } catch {
    /* ignore */
  }
}

function showConnected() {
  claimDisconnected.classList.add('hidden');
  claimConnected.classList.remove('hidden');
  networkBadge.textContent = 'Ethereum';
  networkBadge.classList.add('connected');
  walletAddressEl.textContent = shortenAddress(userAddress);
  mobileWalletHelp?.classList.add('hidden');
  resetVerification();
}

function showDisconnected() {
  claimDisconnected.classList.remove('hidden');
  claimConnected.classList.add('hidden');
  networkBadge.textContent = 'Not connected';
  networkBadge.classList.remove('connected');
  walletEip1193 = null;
  provider = null;
  readProvider = null;
  signer = null;
  userAddress = null;
  lastEligibility = null;
  setClaimError('');
  updateMobileWalletHelp();
}

function getAvailableWallets() {
  const wallets = [];
  const seenProviders = new Set();

  function addWallet(info, eip1193) {
    if (!eip1193 || seenProviders.has(eip1193)) return;
    seenProviders.add(eip1193);
    wallets.push({ info, provider: eip1193 });
  }

  for (const entry of discoveredWallets.values()) {
    addWallet(entry.info, entry.provider);
  }

  const legacy = window.ethereum;
  if (legacy) {
    const legacyProviders = legacy.providers?.length ? legacy.providers : [legacy];
    legacyProviders.forEach((eip1193, index) => {
      const name = eip1193.isMetaMask
        ? 'MetaMask'
        : eip1193.isRabby
          ? 'Rabby'
          : eip1193.isCoinbaseWallet
            ? 'Coinbase Wallet'
            : eip1193.isBraveWallet
              ? 'Brave Wallet'
              : 'Browser Wallet';
      addWallet({ uuid: `legacy-${index}-${name}`, name, icon: null }, eip1193);
    });
  }

  return wallets;
}

async function openWalletPicker() {
  await waitForWalletDiscovery(IS_MOBILE ? 500 : 250);
  const wallets = getAvailableWallets();
  updateMobileWalletHelp();

  if (wallets.length === 0) {
    if (IS_MOBILE) {
      setClaimError('Open this page in MetaMask or Coinbase Wallet, then tap Connect Wallet.');
      mobileWalletHelp?.classList.remove('hidden');
      mobileWalletHelp?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      setClaimError('No Web3 wallet detected. Install MetaMask, Rabby, or Coinbase Wallet.');
    }
    return;
  }
  setClaimError('');
  mobileWalletHelp?.classList.add('hidden');
  if (wallets.length === 1) {
    connectWithProvider(wallets[0].provider);
    return;
  }
  renderWalletPicker(wallets);
  walletModal?.classList.remove('hidden');
}

function renderWalletPicker(wallets) {
  if (!walletList) return;
  walletList.innerHTML = wallets.map(({ info, provider: eip1193 }) => {
    const icon = info.icon
      ? `<img src="${info.icon}" alt="" width="28" height="28">`
      : `<span class="wallet-option-fallback" aria-hidden="true">${(info.name || 'W').slice(0, 1)}</span>`;
    return `
      <button type="button" class="wallet-option" data-wallet-id="${info.uuid}">
        ${icon}
        <span>${info.name || 'Wallet'}</span>
      </button>
    `;
  }).join('');

  walletList.querySelectorAll('.wallet-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wallet = wallets.find((w) => w.info.uuid === btn.dataset.walletId);
      closeWalletModal();
      if (wallet) connectWithProvider(wallet.provider);
    });
  });
}

function closeWalletModal() {
  walletModal?.classList.add('hidden');
}

function bindWalletEvents(eip1193) {
  if (!eip1193?.on) return;
  eip1193.removeAllListeners?.('accountsChanged');
  eip1193.removeAllListeners?.('chainChanged');
  eip1193.on('accountsChanged', handleAccountsChanged);
  eip1193.on('chainChanged', () => window.location.reload());
}

async function connectWithProvider(eip1193) {
  if (!eip1193?.request) {
    setClaimError('Selected wallet does not support Ethereum connections.');
    return;
  }

  try {
    setClaimError('');
    walletEip1193 = eip1193;
    provider = new ethers.BrowserProvider(walletEip1193);
    const accounts = await provider.send('eth_requestAccounts', []);
    if (!accounts?.length) return;

    userAddress = normalizeAddress(accounts[0]);
    signer = await provider.getSigner();

    const onMainnet = await ensureMainnet();
    if (!onMainnet) {
      disconnectWallet();
      return;
    }

    showConnected();
    bindWalletEvents(walletEip1193);
    if (IS_MOBILE) {
      document.getElementById('claimPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    await runEligibilityCheck();
  } catch (err) {
    console.error('Connection failed:', err);
    if (err?.code === 4001) {
      setClaimError('Connection rejected in wallet.');
    } else {
      setClaimError('Could not connect wallet. Please try again.');
    }
  }
}

function disconnectWallet() {
  showDisconnected();
}

async function handleAccountsChanged(accounts) {
  if (!walletEip1193) return;
  if (!accounts?.length) {
    disconnectWallet();
    return;
  }

  try {
    userAddress = normalizeAddress(accounts[0]);
    provider = new ethers.BrowserProvider(walletEip1193);
    signer = await provider.getSigner();
    walletAddressEl.textContent = shortenAddress(userAddress);
    resetVerification();
    await runEligibilityCheck();
  } catch (err) {
    console.error('Account change failed:', err);
    setClaimError('Wallet account changed. Please reconnect.');
  }
}

async function ensureMainnet() {
  if (!provider) return false;
  const network = await provider.getNetwork();
  if (network.chainId === ETH_MAINNET_CHAIN_ID) return true;

  const switchOk = confirm(
    'Switch to Ethereum Mainnet to verify $SHIB holdings.\n\nClick OK to switch networks in your wallet.'
  );
  if (!switchOk) return false;

  try {
    await walletEip1193.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1' }],
    });
    provider = new ethers.BrowserProvider(walletEip1193);
    if (userAddress) signer = await provider.getSigner();
    return true;
  } catch (err) {
    if (err?.code === 4902) {
      setClaimError('Add Ethereum Mainnet in your wallet, then try again.');
    } else if (err?.code !== 4001) {
      setClaimError('Network switch failed. Use Ethereum Mainnet.');
    }
    return false;
  }
}

async function getReadProvider(forceRefresh = false) {
  if (readProvider && !forceRefresh) return readProvider;

  for (const url of READ_RPC_URLS) {
    try {
      const rpc = new ethers.JsonRpcProvider(url, 1, { staticNetwork: true });
      await rpc.getBlockNumber();
      readProvider = rpc;
      return readProvider;
    } catch {
      /* try next RPC */
    }
  }

  if (provider) {
    readProvider = provider;
    return readProvider;
  }

  throw new Error('No Ethereum RPC available for verification.');
}

async function fetchLogsRange(rpc, filter, fromBlock, toBlock) {
  const allLogs = [];
  let chunkSize = IS_MOBILE ? 25_000 : 100_000;
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    const chunkEnd = Math.min(cursor + chunkSize - 1, toBlock);
    let success = false;

    while (!success) {
      try {
        const logs = await rpc.getLogs({ ...filter, fromBlock: cursor, toBlock: chunkEnd });
        allLogs.push(...logs);
        cursor = chunkEnd + 1;
        success = true;
      } catch {
        if (chunkSize <= 2_000) throw new Error('RPC log scan failed');
        chunkSize = Math.max(2_000, Math.floor(chunkSize / 2));
      }
    }
  }

  return allLogs;
}

/**
 * Reverse block scan: walks transfers newest→oldest and stops once the current
 * 10k+ holding streak start is found (skips years of history for most wallets).
 */
async function findStreakStartBlock(address, contractAddress, currentBalance, minBalanceRaw, onProgress) {
  const userLower = address.toLowerCase();
  const paddedAddress = ethers.zeroPadValue(address, 32);
  const rpc = await getReadProvider();
  const currentBlock = await rpc.getBlockNumber();

  const incomingFilter = {
    address: contractAddress,
    topics: [TRANSFER_TOPIC, null, paddedAddress],
  };
  const outgoingFilter = {
    address: contractAddress,
    topics: [TRANSFER_TOPIC, paddedAddress, null],
  };

  let balance = currentBalance;
  let streakStartBlock = null;
  let firstIncomingBlock = null;
  const chunkSize = IS_MOBILE ? 25_000 : 100_000;
  let chunkEnd = currentBlock;
  const scanSpan = Math.max(1, currentBlock - SHIB_DEPLOY_BLOCK);

  while (chunkEnd >= SHIB_DEPLOY_BLOCK) {
    const chunkStart = Math.max(chunkEnd - chunkSize + 1, SHIB_DEPLOY_BLOCK);

    const [incomingLogs, outgoingLogs] = await Promise.all([
      fetchLogsRange(rpc, incomingFilter, chunkStart, chunkEnd),
      fetchLogsRange(rpc, outgoingFilter, chunkStart, chunkEnd),
    ]);

    const transfers = [...incomingLogs, ...outgoingLogs]
      .map((log) => parseTransferLog(log, userLower))
      .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);

    for (const transfer of transfers) {
      if (transfer.direction === 'in') {
        if (firstIncomingBlock === null || transfer.blockNumber < firstIncomingBlock) {
          firstIncomingBlock = transfer.blockNumber;
        }
        balance -= transfer.value;
        if (balance < minBalanceRaw) {
          streakStartBlock = transfer.blockNumber;
          return streakStartBlock;
        }
      } else {
        balance += transfer.value;
      }
    }

    if (onProgress) {
      const scanned = currentBlock - chunkStart;
      onProgress(Math.min(scanned, scanSpan), scanSpan);
    }

    chunkEnd = chunkStart - 1;
  }

  return streakStartBlock ?? firstIncomingBlock;
}

function getHoldCacheKey(address) {
  return `shib-hold-v3-${address.toLowerCase()}`;
}

function readHoldCache(address, currentBlock) {
  try {
    const raw = sessionStorage.getItem(getHoldCacheKey(address));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.ts > ELIGIBILITY_CACHE_TTL_MS) return null;
    if (cached.blockNumber < currentBlock - 50) return null;
    return cached.payload;
  } catch {
    return null;
  }
}

function writeHoldCache(address, currentBlock, payload) {
  try {
    sessionStorage.setItem(
      getHoldCacheKey(address),
      JSON.stringify({ ts: Date.now(), blockNumber: currentBlock, payload })
    );
  } catch {
    /* storage full or private mode */
  }
}

async function computeContinuousTenKHold(address, contractAddress, decimals, onProgress) {
  const minBalanceRaw = ethers.parseUnits(MIN_BALANCE.toString(), decimals);
  const rpc = await getReadProvider();
  const contract = new ethers.Contract(contractAddress, ERC20_ABI, rpc);
  const currentBalance = await contract.balanceOf(address);
  const balanceOk = currentBalance >= minBalanceRaw;

  if (!balanceOk) {
    return {
      balanceOk: false,
      holdOk: false,
      currentBalance,
      daysHeld: 0,
      streakStartDate: null,
      streakStartBlock: null,
    };
  }

  const currentBlock = await rpc.getBlockNumber();
  const cached = readHoldCache(address, currentBlock);
  if (cached) {
    return {
      ...cached,
      currentBalance,
      balanceOk: true,
      streakStartDate: cached.streakStartDate ? new Date(cached.streakStartDate) : null,
    };
  }

  const streakStartBlock = await findStreakStartBlock(
    address,
    contractAddress,
    currentBalance,
    minBalanceRaw,
    onProgress
  );

  if (!streakStartBlock) {
    return {
      balanceOk: true,
      holdOk: false,
      currentBalance,
      daysHeld: 0,
      streakStartDate: null,
      streakStartBlock: null,
    };
  }

  const block = await rpc.getBlock(streakStartBlock);
  const now = Math.floor(Date.now() / 1000);
  const daysHeld = Math.floor((now - block.timestamp) / 86400);
  const holdOk = daysHeld >= MIN_HOLD_DAYS;

  const payload = {
    balanceOk: true,
    holdOk,
    currentBalance,
    daysHeld,
    streakStartDate: new Date(block.timestamp * 1000),
    streakStartBlock,
  };

  writeHoldCache(address, currentBlock, payload);
  return payload;
}

function parseTransferLog(log, userAddressLower) {
  const from = ethers.getAddress(`0x${log.topics[1].slice(26)}`);
  const to = ethers.getAddress(`0x${log.topics[2].slice(26)}`);
  const value = ethers.getBigInt(log.data);
  const direction = to.toLowerCase() === userAddressLower ? 'in' : 'out';
  return {
    blockNumber: log.blockNumber,
    logIndex: log.index,
    from,
    to,
    value,
    direction,
  };
}

function renderEligibilityResult(result) {
  const {
    balanceOk,
    holdOk,
    balanceDisplay,
    holdDisplay,
    daysHeld,
    streakStartDate,
  } = result;

  resultBalanceEl.textContent = `${balanceDisplay} $SHIB`;
  resultBalanceCheckEl.textContent = balanceOk ? 'Pass' : 'Fail';
  resultBalanceCheckEl.className = `result-badge ${balanceOk ? 'pass' : 'fail'}`;

  resultFirstTxEl.textContent = holdDisplay;
  if (streakStartDate) {
    resultHoldCheckEl.textContent = holdOk
      ? `${daysHeld} days — Pass`
      : `${daysHeld} days — Fail`;
    resultHoldCheckEl.className = `result-badge ${holdOk ? 'pass' : 'fail'}`;
  } else {
    resultHoldCheckEl.textContent = 'Fail';
    resultHoldCheckEl.className = 'result-badge fail';
  }

  const eligible = balanceOk && holdOk;
  lastEligibility = { ...result, eligible, checkedAt: Date.now() };
  hideClaimButton();

  if (eligible) {
    resultFinal.className = 'result-final eligible';
    resultFinal.innerHTML = `
      <h4>You're eligible</h4>
      <p>Your wallet holds 10,000+ $SHIB and has maintained that balance continuously for at least 6 months.</p>
    `;
    showClaimButton();
    return;
  }

  const reasons = [];
  if (!balanceOk) reasons.push(`Balance below 10,000 $SHIB (current: ${balanceDisplay})`);
  if (!holdOk) {
    if (streakStartDate) {
      reasons.push(`10,000+ $SHIB held for ${daysHeld} days — need ${MIN_HOLD_DAYS} days`);
    } else if (balanceOk) {
      reasons.push('No continuous 10,000+ $SHIB holding period found (balance may have dropped below 10k in the past)');
    } else {
      reasons.push('No qualifying $SHIB holding history found for this wallet');
    }
  }

  resultFinal.className = 'result-final ineligible';
  resultFinal.innerHTML = `
    <h4>Not eligible yet</h4>
    <p>${reasons.join('. ')}.</p>
  `;
}

async function runEligibilityCheck() {
  if (!provider || !userAddress) return;

  const runId = ++checkRunId;
  verificationStatus.classList.add('hidden');
  verificationResults.classList.add('hidden');
  loadingState.classList.remove('hidden');
  verifyBtn.disabled = true;
  claimBtn && (claimBtn.disabled = true);
  hideClaimButton();
  setClaimError('');

  if (loadingText) loadingText.textContent = 'Checking your $SHIB balance…';
  if (loadingSub) {
    loadingSub.textContent = IS_MOBILE
      ? 'Step 1 of 2 · balance check · keep this tab open'
      : 'Step 1 of 2 · balance check';
  }

  await acquireScreenWakeLock();

  try {
    const onMainnet = await ensureMainnet();
    if (!onMainnet) throw new Error('Wrong network');

    const rpc = await getReadProvider(true);
    const contract = new ethers.Contract(SHIB_CONTRACT, ERC20_ABI, rpc);
    const decimals = await contract.decimals();

    if (runId !== checkRunId) return;

    if (loadingText) loadingText.textContent = 'Scanning $SHIB transfer history…';
    if (loadingSub) {
      loadingSub.textContent = IS_MOBILE
        ? 'Step 2 of 2 · optimized reverse scan · keep tab open'
        : 'Step 2 of 2 · optimized reverse scan (usually 10–40 sec)';
    }

    const holdResult = await computeContinuousTenKHold(
      userAddress,
      SHIB_CONTRACT,
      decimals,
      (scanned, total) => {
        if (runId !== checkRunId || !loadingSub) return;
        const pct = Math.min(100, Math.round((scanned / total) * 100));
        loadingSub.textContent = IS_MOBILE
          ? `Step 2 of 2 · scanning (${pct}%) · keep tab open`
          : `Step 2 of 2 · scanning (${pct}%)`;
      }
    );

    if (runId !== checkRunId) return;

    const balanceDisplay = formatShibBalance(holdResult.currentBalance, decimals);
    const holdDisplay = holdResult.streakStartDate
      ? holdResult.streakStartDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : 'Not held 10k+ continuously';

    renderEligibilityResult({
      balanceOk: holdResult.balanceOk,
      holdOk: holdResult.holdOk,
      balanceDisplay,
      holdDisplay,
      daysHeld: holdResult.daysHeld,
      streakStartDate: holdResult.streakStartDate,
    });

    loadingState.classList.add('hidden');
    verificationResults.classList.remove('hidden');
    verificationStatus.classList.remove('hidden');
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Check again';
    claimBtn && (claimBtn.disabled = false);
  } catch (err) {
    console.error('Eligibility check failed:', err);
    if (runId !== checkRunId) return;

    loadingState.classList.add('hidden');
    verificationStatus.classList.remove('hidden');
    verifyBtn.disabled = false;
    hideClaimButton();

    let message = 'Verification failed. Check your connection and try again.';
    if (err?.message === 'Wrong network') {
      message = 'Please switch to Ethereum Mainnet and try again.';
    } else if (document.hidden && IS_MOBILE) {
      message = 'Verification paused — return to this tab and run the check again.';
    }
    setClaimError(message);
  } finally {
    await releaseScreenWakeLock();
  }
}

// Claim handler wired when AIRDROP_CLAIM_CONTRACT is configured.
async function handleClaim() {
  if (!AIRDROP_CLAIM_CONTRACT || !provider || !userAddress) return;

  claimBtn.disabled = true;
  setClaimError('');

  try {
    await runEligibilityCheck();

    if (!lastEligibility?.eligible) {
      setClaimError('Claim blocked — wallet no longer meets eligibility requirements.');
      return;
    }

    if (!AIRDROP_CLAIM_CONTRACT) {
      resultFinal.className = 'result-final eligible';
      resultFinal.innerHTML = `
        <h4>Eligibility confirmed</h4>
        <p>Your wallet passed verification. The on-chain claim transaction will be enabled here once the airdrop contract is live.</p>
      `;
      hideClaimButton();
      return;
    }

    const claimContract = new ethers.Contract(AIRDROP_CLAIM_CONTRACT, AIRDROP_CLAIM_ABI, signer);
    const tx = await claimContract.claim();
    if (loadingText) loadingText.textContent = 'Waiting for claim confirmation…';
    loadingState.classList.remove('hidden');
    verificationResults.classList.add('hidden');
    await tx.wait();

    resultFinal.className = 'result-final eligible';
    resultFinal.innerHTML = `
      <h4>Claim submitted</h4>
      <p>Transaction confirmed. Your loyalty reward is on the way.</p>
    `;
    hideClaimButton();
  } catch (err) {
    console.error('Claim failed:', err);
    if (err?.code === 4001) {
      setClaimError('Claim cancelled in wallet.');
    } else {
      setClaimError('Claim failed. Please verify eligibility and try again.');
    }
  } finally {
    loadingState.classList.add('hidden');
    verificationResults.classList.remove('hidden');
    claimBtn.disabled = false;
  }
}
