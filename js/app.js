/**
 * $SHIB Loyalty Airdrop — balance + hold duration verification
 */

const SHIB_CONTRACT = '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE';
const MIN_BALANCE = 10_000n;
const MIN_HOLD_DAYS = 180; // 6 months
const ETH_MAINNET_CHAIN_ID = 1n;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

let provider = null;
let signer = null;
let userAddress = null;

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const verifyBtn = document.getElementById('verifyBtn');
const copyContractBtn = document.getElementById('copyContract');
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');

const claimDisconnected = document.getElementById('claimDisconnected');
const claimConnected = document.getElementById('claimConnected');
const networkBadge = document.getElementById('networkBadge');
const walletAddressEl = document.getElementById('walletAddress');
const verificationStatus = document.getElementById('verificationStatus');
const verificationResults = document.getElementById('verificationResults');
const loadingState = document.getElementById('loadingState');
const loadingText = document.getElementById('loadingText');
const resultFinal = document.getElementById('resultFinal');
const resultBalanceEl = document.getElementById('resultBalance');
const resultBalanceCheckEl = document.getElementById('resultBalanceCheck');
const resultFirstTxEl = document.getElementById('resultFirstTx');
const resultHoldCheckEl = document.getElementById('resultHoldCheck');
const claimBtn = document.getElementById('claimBtn');
const claimSoonNote = document.getElementById('claimSoonNote');

menuToggle?.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});

mobileNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => mobileNav.classList.remove('open'));
});

copyContractBtn?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(SHIB_CONTRACT);
    copyContractBtn.innerHTML = '✓';
    setTimeout(() => {
      copyContractBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    }, 2000);
  } catch {
    /* clipboard blocked */
  }
});

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

function hideClaimButton() {
  claimBtn?.classList.add('hidden');
  claimSoonNote?.classList.add('hidden');
}

function showClaimButton() {
  claimBtn?.classList.remove('hidden');
  claimSoonNote?.classList.remove('hidden');
}

function resetVerification() {
  verificationResults.classList.add('hidden');
  loadingState.classList.add('hidden');
  verificationStatus.classList.remove('hidden');
  verifyBtn.disabled = false;
  hideClaimButton();
  resultFinal.className = 'result-final';
  resultFinal.innerHTML = '';
  resultBalanceEl.textContent = '—';
  resultBalanceCheckEl.textContent = '—';
  resultBalanceCheckEl.className = 'result-badge';
  resultFirstTxEl.textContent = '—';
  resultHoldCheckEl.textContent = '—';
  resultHoldCheckEl.className = 'result-badge';
}

function showConnected() {
  claimDisconnected.classList.add('hidden');
  claimConnected.classList.remove('hidden');
  networkBadge.textContent = 'Ethereum';
  networkBadge.classList.add('connected');
  walletAddressEl.textContent = shortenAddress(userAddress);
  resetVerification();
}

function showDisconnected() {
  claimDisconnected.classList.remove('hidden');
  claimConnected.classList.add('hidden');
  networkBadge.textContent = 'Not connected';
  networkBadge.classList.remove('connected');
  provider = null;
  signer = null;
  userAddress = null;
}

async function ensureMainnet() {
  const network = await provider.getNetwork();
  if (network.chainId === ETH_MAINNET_CHAIN_ID) return true;

  const switchOk = confirm(
    'Please switch to Ethereum Mainnet to verify $SHIB holdings.\n\nClick OK to attempt switching networks.'
  );
  if (!switchOk) return false;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1' }],
    });
    return true;
  } catch (err) {
    if (err.code === 4902) {
      alert('Please add Ethereum Mainnet to your wallet manually.');
    }
    return false;
  }
}

async function findEarliestReceipt(address, contractAddress) {
  const paddedAddress = ethers.zeroPadValue(address, 32);
  const currentBlock = await provider.getBlockNumber();
  const launchBlock = 10_600_000;
  let earliestBlock = null;
  const chunkSize = 500_000;

  for (let from = launchBlock; from <= currentBlock; from += chunkSize) {
    const to = Math.min(from + chunkSize - 1, currentBlock);

    const logs = await provider.getLogs({
      address: contractAddress,
      topics: [TRANSFER_TOPIC, null, paddedAddress],
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      const blockNum = log.blockNumber;
      if (earliestBlock === null || blockNum < earliestBlock) {
        earliestBlock = blockNum;
      }
    }

    if (earliestBlock !== null) break;
  }

  if (earliestBlock === null) return null;

  const block = await provider.getBlock(earliestBlock);
  return {
    blockNumber: earliestBlock,
    timestamp: block.timestamp,
    date: new Date(block.timestamp * 1000),
  };
}

function renderEligibilityResult({ balanceOk, holdOk, balanceDisplay, holdDisplay, daysHeld, earliest }) {
  resultBalanceEl.textContent = `${balanceDisplay} $SHIB`;
  resultBalanceCheckEl.textContent = balanceOk ? 'Pass' : 'Fail';
  resultBalanceCheckEl.className = `result-badge ${balanceOk ? 'pass' : 'fail'}`;

  resultFirstTxEl.textContent = holdDisplay;
  if (earliest) {
    resultHoldCheckEl.textContent = holdOk
      ? `${daysHeld} days — Pass`
      : `${daysHeld} days — Fail`;
    resultHoldCheckEl.className = `result-badge ${holdOk ? 'pass' : 'fail'}`;
  } else {
    resultHoldCheckEl.textContent = 'Fail';
    resultHoldCheckEl.className = 'result-badge fail';
  }

  const eligible = balanceOk && holdOk;
  hideClaimButton();

  if (eligible) {
    resultFinal.className = 'result-final eligible';
    resultFinal.innerHTML = `
      <h4>✓ You're eligible</h4>
      <p>Your wallet meets both requirements: 10,000+ $SHIB and a hold period of at least 6 months.</p>
    `;
    showClaimButton();
    return;
  }

  const reasons = [];
  if (!balanceOk) {
    reasons.push(`Balance below 10,000 $SHIB (current: ${balanceDisplay})`);
  }
  if (!holdOk) {
    if (earliest) {
      reasons.push(`Hold period under 6 months (current: ${daysHeld} days)`);
    } else {
      reasons.push('No $SHIB transfer history found for this wallet');
    }
  }

  resultFinal.className = 'result-final ineligible';
  resultFinal.innerHTML = `
    <h4>Not eligible yet</h4>
    <p>${reasons.join('. ')}.</p>
  `;
}

async function connectWallet() {
  if (!window.ethereum) {
    alert('No Web3 wallet detected. Please install MetaMask or another Ethereum wallet.');
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_requestAccounts', []);
    userAddress = accounts[0];
    signer = await provider.getSigner();

    const onMainnet = await ensureMainnet();
    if (!onMainnet) return;

    showConnected();
    await runEligibilityCheck();
  } catch (err) {
    console.error('Connection failed:', err);
  }
}

function disconnectWallet() {
  showDisconnected();
}

connectBtn?.addEventListener('click', connectWallet);
disconnectBtn?.addEventListener('click', disconnectWallet);
verifyBtn?.addEventListener('click', runEligibilityCheck);

if (window.ethereum) {
  window.ethereum.on('accountsChanged', (accounts) => {
    if (accounts.length === 0) {
      disconnectWallet();
    } else {
      userAddress = accounts[0];
      walletAddressEl.textContent = shortenAddress(userAddress);
      resetVerification();
      runEligibilityCheck();
    }
  });

  window.ethereum.on('chainChanged', () => {
    window.location.reload();
  });
}

async function runEligibilityCheck() {
  if (!provider || !userAddress) return;

  verificationStatus.classList.add('hidden');
  verificationResults.classList.add('hidden');
  loadingState.classList.remove('hidden');
  verifyBtn.disabled = true;
  hideClaimButton();

  if (loadingText) {
    loadingText.textContent = 'Checking your $SHIB balance…';
  }

  try {
    const onMainnet = await ensureMainnet();
    if (!onMainnet) {
      loadingState.classList.add('hidden');
      verificationStatus.classList.remove('hidden');
      verifyBtn.disabled = false;
      return;
    }

    const contract = new ethers.Contract(SHIB_CONTRACT, ERC20_ABI, provider);
    const decimals = await contract.decimals();
    const balance = await contract.balanceOf(userAddress);

    const minBalanceRaw = ethers.parseUnits(MIN_BALANCE.toString(), decimals);
    const balanceOk = balance >= minBalanceRaw;
    const balanceDisplay = formatShibBalance(balance, decimals);

    if (loadingText) {
      loadingText.textContent = 'Scanning hold history on-chain…';
    }

    const earliest = await findEarliestReceipt(userAddress, SHIB_CONTRACT);

    let holdOk = false;
    let holdDisplay = 'No $SHIB received';
    let daysHeld = 0;

    if (earliest) {
      const now = Math.floor(Date.now() / 1000);
      daysHeld = Math.floor((now - earliest.timestamp) / 86400);
      holdOk = daysHeld >= MIN_HOLD_DAYS;
      holdDisplay = earliest.date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }

    renderEligibilityResult({
      balanceOk,
      holdOk,
      balanceDisplay,
      holdDisplay,
      daysHeld,
      earliest,
    });

    loadingState.classList.add('hidden');
    verificationResults.classList.remove('hidden');
  } catch (err) {
    console.error('Eligibility check failed:', err);
    loadingState.classList.add('hidden');
    verificationStatus.classList.remove('hidden');
    verifyBtn.disabled = false;
    hideClaimButton();
    alert('Verification failed. Please ensure you are on Ethereum Mainnet and try again.');
  }
}

// Claim button intentionally has no handler — wired up later
