"use client";

import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo } from "react";

import { useProjectDoc } from "@/components/project/ProjectDoc";

import { blueprintHighlight } from "./blueprintHighlight";
import { SaveState } from "./SaveState";
import { useAutosave } from "./useAutosave";

/**
 * The brief. Edits the *body* of project.md — frontmatter is neither shown nor
 * reachable from here, so this component is structurally incapable of corrupting it
 * (see the write rule in docs/03-data-model.md).
 */
export function BriefEditor({ initialBody }: { initialBody: string }) {
  const doc = useProjectDoc();

  const save = useCallback((body: string) => doc.writeBrief(body), [doc]);
  const { value, setValue, status, message, savedAt, flush } = useAutosave({
    initial: initialBody,
    save,
  });

  // Ctrl+S saves now, instead of the browser offering to save the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  const extensions = useMemo(
    () => [
      markdown(),
      blueprintHighlight,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "Brief" }),
    ],
    [],
  );

  // Either writer hitting a conflict locks the whole document.
  const conflicted = doc.conflicted || status === "conflict";

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <span className="label">Brief</span>
        <SaveState status={conflicted ? "conflict" : status} savedAt={savedAt} />
      </div>

      {(message || conflicted) && (
        <div className="notice body-sm" role="alert" data-testid="save-notice">
          {message ?? "This file changed on disk."}{" "}
          {conflicted && (
            <button type="button" className="link-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
        </div>
      )}

      <div className="editor-frame" data-testid="brief-editor" aria-busy={status === "saving"}>
        <CodeMirror
          value={value}
          onChange={setValue}
          extensions={extensions}
          editable={!conflicted}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
            searchKeymap: false,
          }}
          theme="none"
          placeholder="Dump the high-level overview here. No structure required - that is what synthesis is for."
        />
      </div>
    </section>
  );
}
