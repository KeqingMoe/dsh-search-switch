/**
 * Row and dropdown styling.
 *
 * Markup and rules are copied from the General section's own controls —
 * `ui-conversation`'s `EnterBehaviorRow` for the row/trigger geometry and
 * `ui-model-selection`'s picker for the menu surface — then renamed under this
 * plugin's prefix. Class names are stable (not hashed) and every color is a
 * `--dsw-alias-*` theme token, so light/dark and future theme work stay in the
 * host's hands.
 */

/** Stable identity of the injected stylesheet. */
export const STYLE_ID = 'dsh-search-switch/row.css';

/** Class names the components reference. */
export const CLASS = {
  row: 'ssw_row',
  rowText: 'ssw_rowText',
  title: 'ssw_title',
  desc: 'ssw_desc',
  error: 'ssw_error',
  selector: 'ssw_selector',
  selectorLabel: 'ssw_selectorLabel',
  chevron: 'ssw_chevron',
} as const;

const CSS = `
.ssw_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}
.ssw_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:32px;display:flex}
.ssw_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.ssw_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.ssw_error{color:var(--dsw-alias-state-error-primary);font-size:12px;font-weight:400;line-height:18px}
.ssw_selector{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;flex:none;max-width:280px}
.ssw_selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ssw_selector:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.ssw_selectorLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssw_chevron{flex:none;color:var(--dsw-alias-label-caption)}
`;

/**
 * Add this plugin's stylesheet once.
 * @returns the disposer that removes the tag it created.
 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {};
  const selector = `style[data-plugin-css="${STYLE_ID}"]`;
  if (document.querySelector(selector) !== null) return () => {};

  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-search-switch';
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);

  return () => {
    tag.remove();
  };
}
