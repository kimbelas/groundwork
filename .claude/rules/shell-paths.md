# Shell paths — pass absolute paths, do not prefix with `cd`

The Bash tool's **working directory persists between calls**, so re-stating the directory on every
command spends context tokens on something the session already knows — and `cd` inside a compound
command can trigger a permission prompt. Every token in context is re-billed on every later request
of the session, so this is a recurring cost, not a one-off.

- **Pass the full path to the command.** `sed -n '1,40p' /abs/path/file.ts`, not
  `cd /abs/dir && sed -n '1,40p' file.ts`.
- **Use a tool's own directory flag** where it has one: `git -C <dir> status`,
  `npm --prefix <dir> run build`, `dotnet build <path/to.csproj>`, `node <abs script>`.
- **When a tool genuinely needs a working directory** (an interactive dev server, a generator that
  writes relative to cwd), `cd` **once in its own call** and let it persist. Do not prefix the next
  twenty commands with it.
- **Prefer the Grep and Glob tools over shelling out to `grep`/`find`.** They take an absolute
  `path` argument, need no `cd`, and return clickable `file:line` links. Shell `grep` is for
  pipelines, not for locating code.

<!--
This rule has no `paths:` frontmatter on purpose: it applies to every shell call regardless of which
file types are in play, so it must load at launch rather than when a matching file is read.
-->
