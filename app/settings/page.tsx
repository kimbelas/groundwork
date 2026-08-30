import { AccountStatus } from "@/components/settings/AccountStatus";
import { accountContext, cliAccount } from "@/lib/ai/account";

export const dynamic = "force-dynamic";

/**
 * App-level settings. One thing lives here so far: which Claude account the CLI is
 * connected to, asked of the CLI itself (never read off its config files - see
 * lib/ai/account.ts for why), and what to do when the answer is "none".
 */
export default async function SettingsPage() {
  const account = await cliAccount();
  const context = accountContext();

  return (
    <div className="page-blocks" data-testid="settings-page">
      <h1 className="display-lg page-title">Settings</h1>
      <AccountStatus initial={account} engine={context.engine} command={context.command} />
    </div>
  );
}
