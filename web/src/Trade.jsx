import { useEffect, useRef, useState } from 'react';
import { prepareTrade, fetchTradeStatus } from './api.js';
import { pct, shares, usd } from './format.js';
import { BSC_CHAIN_HEX, isUserRejection, sendTransaction, shortAddress, switchToBsc } from './wallet.js';

const EXPLORER = 'https://bscscan.com/tx/';
const USDT = '0x55d398326f99059ff775485246999027b3197955';

// One valid next action at a time:
// connect → switch network → prepare → review → sign → confirming → done (approval loops back to prepare).
export default function Trade({ route, ticker, amount, wallet, walletError, onConnect, onClose }) {
  const [step, setStep] = useState({ name: 'start' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const safeSet = (s) => alive.current && setStep(s);

  const needsNetwork = wallet && wallet.chainId?.toLowerCase() !== BSC_CHAIN_HEX;

  const prepare = async () => {
    safeSet({ name: 'preparing' });
    try {
      const plan = await prepareTrade({ ticker, symbol: route.symbol, usd: amount, wallet: wallet.address });
      safeSet({ name: 'review', plan });
    } catch (err) {
      safeSet({ name: 'error', message: err.message, retry: true });
    }
  };

  const sign = async (plan) => {
    safeSet({ name: 'signing', plan });
    let txHash;
    try {
      txHash = await sendTransaction(wallet.provider, plan.tx);
    } catch (err) {
      return safeSet({ name: 'error', message: isUserRejection(err) ? 'You declined in your wallet. Nothing was sent.' : err.message, retry: true });
    }
    safeSet({ name: 'confirming', plan, txHash });
    const result = await waitForResult(txHash);
    if (!alive.current) return;
    if (result.status === 'success' && plan.step === 'approve') return prepare();
    safeSet({ name: result.status === 'success' ? 'done' : 'failed', plan, txHash, result });
  };

  return (
    <section className="trade" aria-live="polite">
      <div className="trade-head">
        <h3>Buy {route.symbol}</h3>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>

      {!wallet ? (
        <>
          <Action text="Connect a wallet on BNB Chain to continue." label="Connect wallet" onClick={onConnect} />
          {walletError && <p className="notice is-error" role="alert">{walletError}</p>}
        </>
      ) : needsNetwork ? (
        <Action
          text={`${shortAddress(wallet.address)} is on another network.`}
          label="Switch to BNB Chain"
          onClick={() => switchToBsc(wallet.provider).catch((e) => safeSet({ name: 'error', message: e.message }))}
        />
      ) : step.name === 'start' ? (
        <Action
          text={`Nett re-checks ${route.symbol} with a fresh quote for ${usd(amount, 0)}, then simulates the transaction before you sign.`}
          label="Prepare trade"
          onClick={prepare}
        />
      ) : step.name === 'preparing' ? (
        <p className="trade-status">Re-checking price, allowance and simulation…</p>
      ) : step.name === 'review' ? (
        <Review plan={step.plan} onSign={() => sign(step.plan)} onCancel={onClose} />
      ) : step.name === 'signing' ? (
        <p className="trade-status">Waiting for you to confirm in your wallet…</p>
      ) : step.name === 'confirming' ? (
        <p className="trade-status">
          Sent. Waiting for BNB Chain to confirm <TxLink hash={step.txHash} />…
        </p>
      ) : step.name === 'done' ? (
        <Done step={step} />
      ) : step.name === 'failed' ? (
        <div className="notice is-error" role="alert">
          The transaction {step.result?.status === 'timeout' ? 'has not confirmed yet' : 'failed on-chain'}: <TxLink hash={step.txHash} />
        </div>
      ) : step.name === 'error' ? (
        <div className="notice is-error" role="alert">
          {step.message}
          {step.retry && (
            <button type="button" className="link" onClick={prepare}>Try again</button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Action({ text, label, onClick }) {
  return (
    <div className="trade-action">
      <p>{text}</p>
      <button type="button" className="primary" onClick={onClick}>{label}</button>
    </div>
  );
}

function Review({ plan, onSign, onCancel }) {
  const sim = plan.simulation;
  if (plan.step === 'approve') {
    return (
      <div className="review">
        <p>
          First, allow the Binance trading router to spend <strong>exactly {usd(plan.usd)} USDT</strong> from this wallet —
          not an unlimited amount.
        </p>
        <dl className="review-grid">
          <div><dt>Token</dt><dd>USDT</dd></div>
          <div><dt>Spender</dt><dd className="mono-text">{shortAddress(plan.spender)}</dd></div>
          <div><dt>Simulation</dt><dd className={sim.ok ? 'good' : 'bad'}>{sim.ok ? 'Passes' : `Fails: ${sim.failReason || sim.status}`}</dd></div>
        </dl>
        <div className="review-actions">
          <button type="button" className="primary" disabled={!sim.ok} onClick={onSign}>Approve {usd(plan.usd)} USDT in wallet</button>
          <button type="button" className="link" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }
  const spend = sim.balanceChanges?.find((c) => c.contractAddress?.toLowerCase() === USDT);
  return (
    <div className="review">
      <dl className="review-grid">
        <div><dt>You pay</dt><dd>{usd(plan.usd)} USDT</dd></div>
        <div><dt>You get (expected)</dt><dd>{shares(plan.expectedTokens)} {plan.symbol}</dd></div>
        <div><dt>At least</dt><dd>{plan.minTokens ? `${shares(plan.minTokens)} ${plan.symbol}` : '—'} <span className="muted small">({plan.slippagePercent}% slippage cap)</span></dd></div>
        <div><dt>Per real share</dt><dd>{usd(plan.route.perShare)} <span className="muted small">{pct(plan.route.premiumPct)} vs stock</span></dd></div>
        <div><dt>Route</dt><dd>{plan.vendor} · {plan.hops} {plan.hops === 1 ? 'hop' : 'hops'}</dd></div>
        <div><dt>Simulation</dt><dd className={sim.ok ? 'good' : 'bad'}>{sim.ok ? 'Passes' : `Fails: ${sim.failReason || sim.status}`}{spend ? ` · ${spend.change} USDT units` : ''}</dd></div>
      </dl>
      <p className="muted small">The quote behind this transaction expires in about 30 seconds. If your wallet rejects it as stale, prepare again.</p>
      <div className="review-actions">
        <button type="button" className="primary" disabled={!sim.ok} onClick={onSign}>Confirm in wallet</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Done({ step }) {
  const received = step.result.transfers?.find((t) => t.symbol === step.plan.symbol);
  return (
    <div className="notice is-good" role="status">
      <strong>Bought.</strong> {received ? `${received.amount} ${received.symbol} arrived in your wallet.` : 'The swap confirmed.'}{' '}
      <TxLink hash={step.txHash} />
    </div>
  );
}

function TxLink({ hash }) {
  return (
    <a href={EXPLORER + hash} target="_blank" rel="noreferrer" className="mono-text">
      {hash.slice(0, 10)}…
    </a>
  );
}

async function waitForResult(txHash, { timeoutMs = 120_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const s = await fetchTradeStatus(txHash);
      if (s.status === 'success' || s.status === 'fail') return s;
    } catch {
      // keep polling; indexing lags broadcast
    }
  }
  return { status: 'timeout' };
}
