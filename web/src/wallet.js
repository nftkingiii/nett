// Browser wallets via EIP-6963 discovery, with window.ethereum as a fallback.
export const BSC_CHAIN_HEX = '0x38';

export function discoverWallets(onChange) {
  const found = new Map();
  const handler = (event) => {
    const { info, provider } = event.detail ?? {};
    if (!info?.uuid || !provider) return;
    found.set(info.uuid, { id: info.uuid, name: info.name, icon: info.icon, rdns: info.rdns, provider });
    onChange([...found.values()]);
  };
  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // Older wallets only inject window.ethereum.
  setTimeout(() => {
    if (found.size === 0 && window.ethereum) {
      found.set('injected', { id: 'injected', name: 'Browser wallet', icon: null, provider: window.ethereum });
      onChange([...found.values()]);
    }
  }, 400);
  return () => window.removeEventListener('eip6963:announceProvider', handler);
}

export async function connect(provider) {
  const [address] = await provider.request({ method: 'eth_requestAccounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });
  return { address, chainId };
}

export async function switchToBsc(provider) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_CHAIN_HEX }] });
  } catch (err) {
    if (err?.code !== 4902) throw err;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: BSC_CHAIN_HEX,
        chainName: 'BNB Smart Chain',
        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
        rpcUrls: ['https://bsc-dataseed.bnbchain.org'],
        blockExplorerUrls: ['https://bscscan.com'],
      }],
    });
  }
}

const hex = (v) => (v === null || v === undefined || v === '' ? undefined : `0x${BigInt(v).toString(16)}`);

// Sends a transaction built by Nett's server. The wallet shows it to the user and broadcasts it.
export async function sendTransaction(provider, tx) {
  const params = { from: tx.from, to: tx.to, data: tx.data, value: hex(tx.value ?? '0'), gas: hex(tx.gas) };
  if (tx.maxPriorityFeePerGas) {
    params.maxFeePerGas = hex(tx.gasPrice);
    params.maxPriorityFeePerGas = hex(tx.maxPriorityFeePerGas);
  } else if (tx.gasPrice) {
    params.gasPrice = hex(tx.gasPrice);
  }
  return provider.request({ method: 'eth_sendTransaction', params: [params] });
}

export const isUserRejection = (err) => err?.code === 4001 || /reject|denied|cancel/i.test(err?.message ?? '');

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
