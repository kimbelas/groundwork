"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

export interface AutosaveResult<T> {
  value: T;
  setValue: (next: T) => void;
  status: SaveStatus;
  message: string | null;
  savedAt: number | null;
  /** Force a save now, bypassing the debounce. Bound to Ctrl+S by callers. */
  flush: () => void;
}

interface Options<T> {
  initial: T;
  /**
   * Persist the value. Concurrency baselines are deliberately NOT this hook's business
   * — the caller owns them (see ProjectDocProvider), because several editors can share
   * one underlying file. Signal a lost update by throwing with `code: "conflict"`.
   */
  save: (value: T) => Promise<void>;
  delayMs?: number;
}

/**
 * Debounced autosave with an optimistic-concurrency baseline.
 *
 * Three behaviours here are load-bearing rather than incidental:
 *
 *  - **Saves never overlap.** A save started while one is in flight is coalesced into
 *    a single follow-up, so a fast typist cannot produce interleaved writes whose
 *    ordering on disk is undefined.
 *  - **A conflict is terminal.** Once the server says the file changed underneath us,
 *    autosave stops for good. Retrying with a fresh mtime would be precisely the
 *    silent clobber the precondition exists to prevent — the user has to reload and
 *    decide.
 *  - **Unsaved work blocks unload.** The debounce window is small but real.
 *
 * Generic and transport-agnostic so the card editor in Phase 3 reuses it unchanged.
 */
export function useAutosave<T>({ initial, save, delayMs = 1000 }: Options<T>): AutosaveResult<T> {
  const [value, setValueState] = useState<T>(initial);
  const [status, setStatus] = useState<SaveStatus>("clean");
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const valueRef = useRef(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const lockedRef = useRef(false);
  const saveRef = useRef(save);
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  /**
   * Drains edits in a loop rather than recursing. Self-reference inside a useCallback
   * is memoization the React Compiler cannot preserve, and the loop expresses the
   * intent more directly anyway: keep saving until no further edit arrived while the
   * last save was in flight.
   */
  const run = useCallback(async () => {
    if (lockedRef.current) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    inFlightRef.current = true;
    try {
      do {
        pendingRef.current = false;
        setStatus("saving");

        try {
          await saveRef.current(valueRef.current);
          setStatus("saved");
          setSavedAt(Date.now());
          setMessage(null);
        } catch (e) {
          const err = e as { code?: string; message?: string };
          if (err.code === "conflict") {
            lockedRef.current = true;
            pendingRef.current = false;
            setStatus("conflict");
            setMessage(err.message ?? "This file changed on disk.");
          } else {
            setStatus("error");
            setMessage(err.message ?? "Could not save.");
          }
          return;
        }
      } while (pendingRef.current && !lockedRef.current);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    flushRef.current = () => void run();
  }, [run]);

  const setValue = useCallback(
    (next: T) => {
      valueRef.current = next;
      setValueState(next);
      if (lockedRef.current) return;

      setStatus("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flushRef.current(), delayMs);
    },
    [delayMs],
  );

  const flush = useCallback(() => flushRef.current(), []);

  // Clear a pending debounce on unmount so a timer cannot fire against a dead component.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // The debounce window is short, but closing the tab inside it would still lose work.
  useEffect(() => {
    if (status !== "dirty" && status !== "saving") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  return { value, setValue, status, message, savedAt, flush };
}
