"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { authMethodLabel, planLabel } from "@/lib/labels";

import type { AccountStatus as Status } from "@/lib/ai/account";

/**
 * Which Claude account the CLI is signed into, and what to do if it is not.
 *
 * `initial` is the server's answer; a Re-check result is held as an override and the
 * rendered value derived from the two, so the server prop is never copied into state.
 * The app cannot sign in on the user's behalf - `claude auth login` is an interactive
 * browser flow - so every state that needs action gives the exact command to run.
 */
export function AccountStatus({
  initial,
  engine,
  command,
}: {
  initial: Status;
  engine: string;
  command: string;
}) {
  const [override, setOverride] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = override ?? initial;

  async function recheck() {
    setChecking(true);
    setError(null);
    try {
      // A refresh spawns a process, so it is a POST behind the same-origin guard.
      const res = await fetch("/api/ai/account", { method: "POST" });
      if (!res.ok) throw new Error(`Could not check (${res.status})`);
      const data = (await res.json()) as { account: Status };
      setOverride(data.account);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="raised settings-card" data-testid="account-status" data-state={status.state}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p className="label" style={{ margin: 0 }}>
          Claude account
        </p>
        <Button onClick={() => void recheck()} disabled={checking} data-testid="account-recheck">
          {checking ? "Checking…" : "Re-check"}
        </Button>
      </div>

      <StatusBody status={status} />

      {error && <Notice>{error}</Notice>}

      <p className="body-sm faint settings-meta" style={{ margin: 0 }}>
        Engine <span className="mono">{engine}</span> · CLI <span className="mono">{command}</span>
      </p>
    </section>
  );
}

function StatusBody({ status }: { status: Status }) {
  switch (status.state) {
    case "connected": {
      const plan = planLabel(status.subscriptionType);
      return (
        <div className="stack" style={{ gap: 6 }}>
          <p className="body" style={{ margin: 0 }} data-testid="account-identity">
            Signed in as <strong>{status.email ?? "an account the CLI did not name"}</strong>
            {status.orgName && <> · {status.orgName}</>}
            {plan && <> · {plan}</>}
          </p>
          <p className="body-sm soft" style={{ margin: 0 }}>
            {authMethodLabel(status.authMethod)}. AI runs use this account and cost nothing
            beyond it. To switch, run <Command text="claude auth logout" /> then{" "}
            <Command text="claude auth login" /> in a terminal, and Re-check.
          </p>
        </div>
      );
    }
    case "signed-out":
      return (
        <div className="stack" style={{ gap: 10 }}>
          <Notice>The Claude CLI is installed, but no account is signed in. AI runs will fail until one is.</Notice>
          <ol className="settings-steps body-sm">
            <li>Open a terminal.</li>
            <li>
              Run <Command text="claude auth login" />. A browser window opens to sign in with
              your Claude subscription; add <code className="mono">--console</code> to bill API
              usage instead.
            </li>
            <li>Come back here and Re-check.</li>
          </ol>
          <p className="body-sm faint" style={{ margin: 0 }}>
            This app cannot sign in for you: the login is an interactive browser flow that
            belongs to the CLI.
          </p>
        </div>
      );
    case "missing":
      return (
        <div className="stack" style={{ gap: 10 }}>
          <Notice>
            Nothing answered at <code className="mono">{status.looked}</code> — the Claude CLI
            is not there, or could not run. AI runs will fail until it can.
          </Notice>
          <ol className="settings-steps body-sm">
            <li>
              Install it: <Command text="npm i -g @anthropic-ai/claude-code" />
            </li>
            <li>
              Sign in: <Command text="claude auth login" />
            </li>
            <li>
              Or, if it is installed elsewhere, set{" "}
              <code className="mono">GROUNDWORK_CLAUDE_CMD</code> to its path and restart the app.
            </li>
            <li>Then Re-check.</li>
          </ol>
        </div>
      );
    case "unknown":
      return (
        <div className="stack" style={{ gap: 10 }}>
          <Notice>Could not tell whether an account is signed in: {status.detail}</Notice>
          <p className="body-sm faint" style={{ margin: 0 }}>
            Try Re-check. If it keeps failing, run{" "}
            <Command text="claude auth status" /> in a terminal to see what the CLI says.
          </p>
        </div>
      );
    case "fixture":
      return (
        <p className="body-sm soft" style={{ margin: 0 }}>
          The deterministic test engine is selected (
          <code className="mono">GROUNDWORK_AI_ENGINE=fixture</code>); no account is used and
          nothing is spawned.
        </p>
      );
  }
}

/** A command to run, with a copy button beside it. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the text is right there to select */
    }
  }

  return (
    <span className="settings-command">
      <code className="mono">{text}</code>
      <button type="button" className="link-button" onClick={() => void copy()}>
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
