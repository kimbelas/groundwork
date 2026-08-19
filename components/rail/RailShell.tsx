"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * App shell with a rail that becomes a drawer on small screens.
 *
 * The rail arrives as a prop rather than being rebuilt here, so it stays a server
 * component and the project list still needs no client fetch.
 *
 * The drawer closes on navigation by delegating from the container: any click that
 * landed on a link closes it. Doing that in an effect keyed on the pathname would mean
 * calling setState during an effect, which cascades renders — and this is simpler.
 */
export function RailShell({ rail, children }: { rail: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="menu-button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="vault-rail"
          onClick={() => setOpen((v) => !v)}
          data-testid="menu-toggle"
        >
          <MenuIcon open={open} />
        </button>
        <Link href="/" className="topbar-brand">
          Groundwork
        </Link>
      </header>

      <div className="shell">
        <div
          id="vault-rail"
          data-open={open}
          className="rail-host"
          onClick={(e) => {
            // instanceof rather than a cast: e.target is an EventTarget, and a text
            // node or the SVG can be the target too.
            if (e.target instanceof Element && e.target.closest("a")) setOpen(false);
          }}
        >
          {rail}
        </div>

        {open && (
          <button
            type="button"
            className="overlay"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            data-testid="rail-overlay"
          />
        )}

        <main className="pane">{children}</main>
      </div>
    </>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
      {open ? (
        <path
          d="M5 5l12 12M17 5L5 17"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <path
          d="M3 6h16M3 11h16M3 16h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}
