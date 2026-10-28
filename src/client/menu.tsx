/**
 * Dropdown built on the Harness platform's own `Menu`.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is a baseline entry in the Web shell's
 * frozen module table, so the browser bundle can require it the way the shipped
 * settings rows do — that is what makes the trigger geometry, the menu surface
 * colors, the popover placement, the keyboard walk, and the outside-click and
 * window-blur dismissal identical to every other settings dropdown instead of
 * an approximation.
 *
 * Trade-off: this is a platform interface, not a published plugin contract. It
 * is stable within a DSH release and can change between them, so the plugin is
 * meant to be built against the release it runs on (`pnpm run typecheck` uses
 * the installed types) and the render is covered by the smoke test.
 */

import {
  IconChevronDownOutlineRegular,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { type ReactElement, useState } from 'react';

import { CLASS } from './styles.ts';

/** One selectable row in the menu. */
export interface MenuOption {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface MenuProps {
  /** Option list, already ordered by the caller. */
  readonly options: readonly MenuOption[];
  /** Currently selected id, or undefined for none. */
  readonly value: string | undefined;
  /** Text shown on the trigger. */
  readonly display: string;
  /** Accessible name of the trigger. */
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
}

/** Settings-style select: a flush trigger that opens the platform menu. */
export function SelectMenu({
  options,
  value,
  display,
  ariaLabel,
  disabled = false,
  onSelect,
}: MenuProps): ReactElement {
  const [open, setOpen] = useState(false);

  const items: MenuEntry[] = options.map((option) => ({
    id: option.id,
    label: option.label,
    ...(option.disabled === true ? { disabled: true } : {}),
  }));

  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      items={items}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false);
        onSelect(id);
      }}
      align="end"
      portal
      anchor={
        <button
          type="button"
          className={CLASS.selector}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span className={CLASS.selectorLabel}>{display}</span>
          <IconChevronDownOutlineRegular className={CLASS.chevron} />
        </button>
      }
    />
  );
}
