# VideoCAT Agent Notes

## GitHub Publishing

- The active GitHub CLI identity for this workspace is `reiterstahl`.
- Before treating GitHub publishing as blocked, run `gh auth status` from the current user session.
- Do not store, print, or commit GitHub tokens.
- When the repository owner explicitly asks to push `main`, commit the confirmed VideoCAT scope directly to `main` and push it over HTTPS.

## UI Conventions

- **No coloured accent lines on one edge of a rounded element.** Never mark a panel, card, dialog block, button or badge with a coloured `border-top`, `border-left` (or any single edge), nor with a tinted outline whose colour is the accent: on rounded corners the line curves and looks broken.
- **To mark a kind or a state, use a straight vertical line on the left**, the house style already used by catalog rows:
  - square elements (table rows, flat blocks): `box-shadow: inset 4px 0 0 <color>` or a plain `border-left`;
  - rounded elements: add the class `vc-accent-bar` and set `--vc-accent-bar-color` (a 4 px straight line inset from the corners, defined in `apps/web/src/views.css`).
- Colour can still live in icons, text, small tags and progress bars; outlines stay neutral (`var(--vc-border)`).
