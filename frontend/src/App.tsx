import { connect, disconnect, isConnected, request } from "@stacks/connect";
import {
  Cl,
  cvToHex,
  cvToJSON,
  hexToCV,
  type ClarityValue,
} from "@stacks/transactions";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  "SP3CPTJFP3TQK00DV0B5SGE8R0N3Z40MWJ6QZD38Y";
const CONTRACT_NAME = import.meta.env.VITE_CONTRACT_NAME || "public-kudos";
const STACKS_API_BASE =
  import.meta.env.VITE_STACKS_API_BASE || "https://api.hiro.so";
const NETWORK = (import.meta.env.VITE_STACKS_NETWORK || "mainnet") as
  | "mainnet"
  | "testnet";

const CATEGORIES = [
  { id: 1, label: "Builder" },
  { id: 2, label: "Designer" },
  { id: 3, label: "Educator" },
  { id: 4, label: "Helpful" },
  { id: 5, label: "Community" },
] as const;

const CATEGORY_NOTES: Record<number, string> = {
  1: "Shipping ideas into usable products.",
  2: "Crafting visuals and experience details.",
  3: "Teaching patterns and fundamentals.",
  4: "Unblocking people with practical support.",
  5: "Strengthening the wider ecosystem.",
};

type CategoryId = (typeof CATEGORIES)[number]["id"];

type ProfileState = {
  counts: Record<number, number>;
  total: number;
  activeByCategory: Record<number, boolean>;
  lastActionHeight: number;
};

const DEFAULT_PROFILE: ProfileState = {
  counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  total: 0,
  activeByCategory: { 1: false, 2: false, 3: false, 4: false, 5: false },
  lastActionHeight: 0,
};

const ERROR_HINTS: Record<string, string> = {
  u100: "Invalid category selected.",
  u101: "You cannot give kudos to yourself.",
  u102: "Kudos for this category already exists.",
  u103: "No existing kudos found to revoke.",
  u104: "Cooldown active. Wait a few blocks and try again.",
};

function unwrapValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return unwrapValue((value as { value: unknown }).value);
  }
  return value;
}

function asNumber(value: unknown): number {
  const inner = unwrapValue(value);
  if (typeof inner === "string" && /^\d+$/.test(inner)) return Number(inner);
  if (typeof inner === "number") return inner;
  return 0;
}

function asBool(value: unknown): boolean {
  const inner = unwrapValue(value);
  return Boolean(inner);
}

function extractResponseValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const response = value as { success?: boolean; value?: unknown };
  if (response.success === false)
    throw new Error("Read-only call returned err response");
  if ("value" in response) return response.value;
  return value;
}

function humanizeContractError(error: unknown): string {
  const text = error instanceof Error ? error.message : "Transaction failed";
  const matched = Object.entries(ERROR_HINTS).find(([code]) =>
    text.includes(code),
  );
  return matched ? matched[1] : text;
}

function formatPrincipal(value: string): string {
  if (!value) return "-";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-7)}`;
}

function App() {
  const [address, setAddress] = useState("");
  const [targetAddressInput, setTargetAddressInput] = useState("");
  const [targetAddress, setTargetAddress] = useState("");
  const [profile, setProfile] = useState<ProfileState>(DEFAULT_PROFILE);
  const [history, setHistory] = useState<string[]>([]);
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const contractId = useMemo(
    () => `${CONTRACT_ADDRESS}.${CONTRACT_NAME}` as `${string}.${string}`,
    [],
  );
  const walletConnected = Boolean(address);

  const callReadOnly = useCallback(
    async (functionName: string, args: string[] = []) => {
      const sender = address || CONTRACT_ADDRESS;
      const response = await fetch(
        `${STACKS_API_BASE}/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/${functionName}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender, arguments: args }),
        },
      );

      const data = await response.json();
      if (!data.okay) {
        throw new Error(data.cause || `Read failed: ${functionName}`);
      }
      return cvToJSON(hexToCV(data.result));
    },
    [address],
  );

  const callTx = useCallback(
    async (functionName: string, functionArgs: ClarityValue[]) => {
      return request("stx_callContract", {
        contract: contractId,
        functionName,
        functionArgs,
        network: NETWORK,
        postConditionMode: "deny",
        sponsored: false,
      });
    },
    [contractId],
  );

  const refreshProfile = useCallback(
    async (recipient: string) => {
      if (!recipient || !address) return;
      setLoading(true);
      try {
        const countCalls = CATEGORIES.map((category) =>
          callReadOnly("get-category-count", [
            cvToHex(Cl.principal(recipient)),
            cvToHex(Cl.uint(category.id)),
          ]),
        );
        const activeCalls = CATEGORIES.map((category) =>
          callReadOnly("has-kudos", [
            cvToHex(Cl.principal(address)),
            cvToHex(Cl.principal(recipient)),
            cvToHex(Cl.uint(category.id)),
          ]),
        );

        const [categoryResults, totalResult, activeResults, lastResult] =
          await Promise.all([
            Promise.all(countCalls),
            callReadOnly("get-total-kudos", [cvToHex(Cl.principal(recipient))]),
            Promise.all(activeCalls),
            callReadOnly("get-last-action-height", [
              cvToHex(Cl.principal(address)),
              cvToHex(Cl.principal(recipient)),
            ]),
          ]);

        const counts: Record<number, number> = {};
        const activeByCategory: Record<number, boolean> = {};

        CATEGORIES.forEach((category, idx) => {
          counts[category.id] = asNumber(
            extractResponseValue(categoryResults[idx]),
          );
          activeByCategory[category.id] = asBool(
            extractResponseValue(activeResults[idx]),
          );
        });

        setProfile({
          counts,
          total: asNumber(extractResponseValue(totalResult)),
          activeByCategory,
          lastActionHeight: asNumber(extractResponseValue(lastResult)),
        });
        setStatus(`Loaded profile for ${recipient}`);
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Failed to refresh profile",
        );
      } finally {
        setLoading(false);
      }
    },
    [address, callReadOnly],
  );

  useEffect(() => {
    const cached = localStorage.getItem("kudos-address");
    if (cached && isConnected()) {
      setAddress(cached);
      setTargetAddress(cached);
      setTargetAddressInput(cached);
    }
  }, []);

  useEffect(() => {
    if (!walletConnected || !targetAddress) return;
    refreshProfile(targetAddress).catch(() => undefined);
  }, [refreshProfile, targetAddress, walletConnected]);

  const onConnect = async () => {
    try {
      const response = await connect();
      const walletAddress = response.addresses[0].address;
      setAddress(walletAddress);
      setTargetAddress(walletAddress);
      setTargetAddressInput(walletAddress);
      localStorage.setItem("kudos-address", walletAddress);
      setStatus("Wallet connected");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Wallet connection failed",
      );
    }
  };

  const onDisconnect = () => {
    disconnect();
    localStorage.removeItem("kudos-address");
    setAddress("");
    setTargetAddress("");
    setTargetAddressInput("");
    setProfile(DEFAULT_PROFILE);
    setHistory([]);
    setStatus("Wallet disconnected");
  };

  const addHistory = (item: string) => {
    setHistory((current) => [item, ...current].slice(0, 12));
  };

  const setOptimisticCategory = (category: CategoryId, giving: boolean) => {
    setProfile((current) => {
      const active = current.activeByCategory[category];
      if ((giving && active) || (!giving && !active)) return current;
      const nextCount = Math.max(
        0,
        current.counts[category] + (giving ? 1 : -1),
      );

      return {
        ...current,
        counts: {
          ...current.counts,
          [category]: nextCount,
        },
        activeByCategory: {
          ...current.activeByCategory,
          [category]: giving,
        },
        total: Math.max(0, current.total + (giving ? 1 : -1)),
      };
    });
  };

  const submitAction = async (
    functionName: "give-kudos" | "revoke-kudos",
    category: CategoryId,
  ) => {
    if (!targetAddress) {
      setStatus("Enter a target address first");
      return;
    }

    if (targetAddress === address) {
      setStatus("Self kudos is not allowed");
      return;
    }

    setSubmitting(true);
    const snapshot = profile;
    setOptimisticCategory(category, functionName === "give-kudos");

    try {
      const response = await callTx(functionName, [
        Cl.principal(targetAddress),
        Cl.uint(category),
      ]);
      const txid = (response as { txid?: string }).txid ?? "submitted";
      const categoryLabel =
        CATEGORIES.find((c) => c.id === category)?.label ?? `#${category}`;
      const verb = functionName === "give-kudos" ? "gave" : "revoked";
      addHistory(
        `${verb} ${categoryLabel} kudos ${functionName === "give-kudos" ? "to" : "from"} ${targetAddress}`,
      );
      setStatus(`${functionName} submitted: ${txid}`);
      await refreshProfile(targetAddress);
    } catch (error) {
      setProfile(snapshot);
      setStatus(humanizeContractError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const onLoadProfile = async () => {
    const input = targetAddressInput.trim();
    if (!input) {
      setStatus("Enter a valid principal address");
      return;
    }
    setTargetAddress(input);
    await refreshProfile(input);
  };

  const shortAddress = walletConnected
    ? `${address.slice(0, 7)}...${address.slice(-6)}`
    : "Disconnected";

  const totalGiven = CATEGORIES.reduce(
    (acc, category) => acc + (profile.activeByCategory[category.id] ? 1 : 0),
    0,
  );

  const targetReady = Boolean(targetAddress) && targetAddress !== address;

  if (!walletConnected) {
    return (
      <main className="app is-locked">
        <header className="topbar glass-card">
          <p className="brand">Prism Applause</p>
          <span className="network-pill">{NETWORK}</span>
        </header>

        <section className="hero glass-card">
          <p className="eyebrow">Public Kudos and Endorsements</p>
          <h1>Build trust with visible on-chain appreciation.</h1>
          <p className="muted hero-copy">
            Endorse collaborators across five categories with transparent,
            verifiable records on Stacks.
          </p>
          <div className="hero-actions">
            <button className="accent" onClick={onConnect}>
              Connect Wallet
            </button>
          </div>
        </section>

        <section className="locked-panel glass-card">
          <h2>Wallet Required</h2>
          <p>
            Connect to load profile stats, endorse categories, and submit
            transactions.
          </p>
          <div className="inline-meta">
            <span>Contract</span>
            <strong>{contractId}</strong>
          </div>
        </section>

        <footer className="status glass-card">{status}</footer>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar glass-card">
        <p className="brand">Prism Applause</p>
        <div className="actions">
          <span className="network-pill">{NETWORK}</span>
          <button
            className="ghost"
            onClick={() => refreshProfile(targetAddress)}
            disabled={loading || submitting || !targetAddress}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="accent" onClick={onDisconnect}>
            Disconnect {shortAddress}
          </button>
        </div>
      </header>

      <section className="hero glass-card">
        <div>
          <p className="eyebrow">Public Kudos and Endorsements</p>
          <h1>Recognize people publicly, one category at a time.</h1>
          <p className="muted hero-copy">
            Every endorsement lives on-chain and can be revoked anytime based on
            your current assessment.
          </p>
        </div>
        <div className="hero-metrics">
          <article>
            <span>Total received</span>
            <strong>{profile.total}</strong>
          </article>
          <article>
            <span>Given by you</span>
            <strong>{totalGiven}</strong>
          </article>
          <article>
            <span>Last action height</span>
            <strong>{profile.lastActionHeight}</strong>
          </article>
        </div>
      </section>

      <section className="meta-row">
        <div className="meta-card glass-card">
          <span>Target profile</span>
          <strong>{formatPrincipal(targetAddress)}</strong>
        </div>
        <div className="meta-card glass-card">
          <span>Your wallet</span>
          <strong>{shortAddress}</strong>
        </div>
        <div className="meta-card glass-card">
          <span>Network</span>
          <strong>{NETWORK}</strong>
        </div>
        <div className="meta-card glass-card">
          <span>Contract</span>
          <strong className="contract-id">{contractId}</strong>
        </div>
      </section>

      <section className="layout-grid">
        <article className="controls-panel glass-card">
          <h2>Load Profile</h2>
          <p className="muted small">
            Enter a principal to inspect endorsements and submit category
            actions.
          </p>
          <label>
            Profile principal
            <input
              value={targetAddressInput}
              onChange={(e) => setTargetAddressInput(e.target.value)}
              placeholder="SP... recipient principal"
            />
          </label>
          <div className="control-actions">
            <button
              className="accent"
              onClick={onLoadProfile}
              disabled={submitting || loading}
            >
              Load profile
            </button>
            <button
              className="ghost"
              onClick={() => {
                setTargetAddressInput(address);
                setTargetAddress(address);
                refreshProfile(address).catch(() => undefined);
              }}
              disabled={submitting || loading}
            >
              View my profile
            </button>
          </div>
        </article>

        <article className="history-list glass-card">
          <h2>Recent Local Activity</h2>
          {history.length === 0 ? (
            <p className="muted">No actions yet.</p>
          ) : (
            <div className="history-items">
              {history.map((item, idx) => (
                <article className="history-card" key={`${item}-${idx}`}>
                  <p>{item}</p>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="poll-list category-grid">
        <h2>Kudos Categories</h2>
        <p className="muted small">
          Endorsement state is per target and category. Cooldown rules are
          enforced by contract.
        </p>
        <div className="category-cards">
          {CATEGORIES.map((category, idx) => {
            const isActive = profile.activeByCategory[category.id];
            const count = profile.counts[category.id] ?? 0;
            const canAct = targetReady && !submitting;

            return (
              <article
                className="category-card glass-card"
                key={category.id}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <div className="poll-head">
                  <h3>{category.label}</h3>
                  <span className={isActive ? "chip open" : "chip closed"}>
                    {isActive ? "Endorsed" : "Inactive"}
                  </span>
                </div>
                <p className="muted small">{CATEGORY_NOTES[category.id]}</p>
                <div className="kudos-count">{count}</div>
                <div className="poll-foot">
                  <button
                    className="accent"
                    onClick={() => submitAction("give-kudos", category.id)}
                    disabled={!canAct || isActive}
                    title={
                      !targetReady
                        ? "Choose another target profile first"
                        : "Submit give-kudos transaction"
                    }
                  >
                    Give Kudos
                  </button>
                  <button
                    className="ghost"
                    onClick={() => submitAction("revoke-kudos", category.id)}
                    disabled={!canAct || !isActive}
                    title={
                      !targetReady
                        ? "Choose another target profile first"
                        : "Submit revoke-kudos transaction"
                    }
                  >
                    Revoke
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="status glass-card">{status}</footer>
    </main>
  );
}

export default App;
