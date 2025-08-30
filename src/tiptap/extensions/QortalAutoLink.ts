// qortalAutoLink.ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// Match a qortal:// candidate possibly containing internal words separated by single/multiple spaces.
// We’ll trim trailing whitespace later and encode internal spaces to %20.
const QORTAL_CANDIDATE_RE = /qortal:\/\/[^\s<>"']+(?:\s+[^\s<>"']+)*/gi;

// A quick sanity check that the scheme looks right
function looksLikeQortalHref(raw: string) {
  return /^qortal:\/\//i.test(raw);
}

// Encode internal spaces but do not touch existing encodings.
// This is intentionally conservative.
function sanitizeQortalHref(raw: string): string | null {
  if (!looksLikeQortalHref(raw)) return null;

  return raw;

}

function linkifyCurrentBlock(view: EditorView) {
  const { state } = view;
  const { tr, selection, doc } = state;
  const markType = state.schema.marks.link;
  if (!markType) return false;

  // Limit to current textblock for performance
  const $from = selection.$from;
  const blockStart = $from.start();
  const blockEnd = $from.end();
  const text = doc.textBetween(blockStart, blockEnd, '\n', '\n');
  if (!text) return false;

  let changed = false;
  let m: RegExpExecArray | null;
  QORTAL_CANDIDATE_RE.lastIndex = 0;

  while ((m = QORTAL_CANDIDATE_RE.exec(text))) {
    const matchText = m[0];

    // Calculate absolute positions in doc
    const from = blockStart + m.index;
    const to = from + matchText.length;

    // Skip if a link mark already covers this range
    if (doc.rangeHasMark(from, to, markType)) continue;

    const href = sanitizeQortalHref(matchText);
    if (!href) continue;

    // Apply mark
    const attrs = { href };
    tr.addMark(from, to - (matchText.length - href.length), markType.create(attrs));
    changed = true;
  }

  if (changed) {
    // Make the link mark not continue typing after it
    tr.removeStoredMark(markType);
    view.dispatch(tr);
  }
  return changed;
}

/**
 * Explicit command to create/update a Qortal link on the current selection.
 * If selection is empty and the cursor is within/next to a candidate, it expands to it.
 */
export function applyQortalLink(view: EditorView, rawHref?: string): boolean {
  const { state } = view;
  const { tr, selection, doc } = state;
  const markType = state.schema.marks.link;
  if (!markType) return false;

  let href: string | null = rawHref ?? null;

  // If no href provided, try to use selection text
  if (!href && !selection.empty) {
    const selText = doc.textBetween(selection.from, selection.to, '\n', '\n');
    href = sanitizeQortalHref(selText);
  }

  // If still no href and caret is inside a candidate, expand to it
  if (!href && selection.empty) {
    const $pos = selection.$from;
    const blockStart = $pos.start();
    const blockEnd = $pos.end();
    const text = doc.textBetween(blockStart, blockEnd, '\n', '\n');

    // Find the candidate around the cursor by scanning the block
    let foundFrom = -1;
    let foundTo = -1;
    let foundHref: string | null = null;

    QORTAL_CANDIDATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QORTAL_CANDIDATE_RE.exec(text))) {
      const absFrom = blockStart + m.index;
      const absTo = absFrom + m[0].length;
      if (absFrom <= selection.from && selection.from <= absTo) {
        foundFrom = absFrom;
        foundTo = absTo;
        foundHref = sanitizeQortalHref(m[0]);
        break;
      }
    }

    if (foundHref) {
      href = foundHref;
      // expand selection range when applying mark
      tr.addMark(foundFrom, foundTo - (m![0].length - foundHref.length), markType.create({ href }));
      tr.removeStoredMark(markType);
      view.dispatch(tr);
      return true;
    }
  }

  if (!href) return false;

  // Apply/replace link to current selection
  const { from, to } = selection;
  if (from === to) return false; // require a selection if not expanded above

  tr.addMark(from, to, markType.create({ href }));
  tr.removeStoredMark(markType);
  view.dispatch(tr);
  return true;
}

export const QortalAutoLink = Extension.create({
  name: 'qortalAutoLink',

  addProseMirrorPlugins() {
    const key = new PluginKey('qortalAutoLink');

    return [
      new Plugin({
        key,
        props: {
          /**
           * Only run linkify AFTER a terminator is typed:
           * space, enter (newline comes as "\n"), or common punctuation.
           * Signature: (view, from, to, text)
           */
          handleTextInput(view: EditorView, _from, _to, text: string) {
            if (!text) return false;
            // Trigger on whitespace or common terminators
            if (/\s|[)\]}.,!?;:]/.test(text)) {
              // Defer to allow the insertion to land
              setTimeout(() => linkifyCurrentBlock(view), 0);
            }
            return false; // don’t stop other handlers
          },

          handlePaste(view: EditorView) {
            setTimeout(() => linkifyCurrentBlock(view), 0);
            return false;
          },

          // Optional: also fix up on blur (user moved on)
          handleDOMEvents: {
            blur: (view: EditorView) => {
              setTimeout(() => linkifyCurrentBlock(view), 0);
              return false;
            },
          },

          /**
           * Optional: If someone clicks a qortal:// link inside the editor,
           * don’t let the browser navigate. Dispatch your app event instead.
           * (Comment out if you rely on your global capture handler already.)
           */
          handleClickOn(_view, _pos, _node, _nodePos, event) {
            const a = (event.target as HTMLElement | null)?.closest('a');
            const href = a?.getAttribute('href') || '';
            if (!href.startsWith('qortal://')) return false;
            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('qdn-open-link', { detail: { href } }));
            return true;
          },
        },
      }),
    ];
  },
});
