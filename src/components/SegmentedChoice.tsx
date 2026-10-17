import React, { useId } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** One short line under the label. Use it where the choice is not self-explanatory. */
  hint?: string;
}

interface SegmentedChoiceProps<T extends string> {
  /** Shown above the control, in the app's one label style. */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/**
 * A two-or-three-way choice, styled like the rest of the app.
 *
 * It replaces the native `<input type="radio">` groups, which were the only OS-drawn controls
 * left in the interface. That is why the settings panels read as a web form dropped into a
 * desktop app: a native radio is a small grey circle the operating system draws to its own
 * conventions, sitting among cards with 16px corners and black uppercase labels. Nothing else on
 * screen looks like it, and on Windows it does not even look like the same control as on a Mac.
 *
 * The radios are still here, one per option — kept, not faked. They carry keyboard and screen
 * reader behaviour that is tedious and easy to get wrong by hand: arrow keys move within the
 * group and skip past it on Tab, and the group is announced as a set with a position in it. They
 * are hidden visually with `sr-only` and drive the appearance of the label beside them through
 * `peer-checked`, so what the user sees is ours and what assistive technology hears is the
 * platform's.
 *
 * `useId` namespaces the `name` attribute, because two of these on one screen sharing a name
 * would behave as a single group — selecting in one would clear the other.
 */
export function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedChoiceProps<T>) {
  const groupName = useId();

  return (
    <fieldset>
      <legend className="text-sm font-bold text-gray-900 mb-2">{label}</legend>
      <div className="flex gap-2">
        {options.map((option) => (
          <label key={option.value} className="flex-1 cursor-pointer">
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only peer"
            />
            {/*
              gray-500, not -200. The border is the only thing marking an unselected segment out
              as a control — it is white on white otherwise — and 1.4.11 wants 3:1 for that:
              gray-200 was 1.24:1, gray-400 is 2.54:1, gray-500 is 4.83:1. Same reasoning, and
              the same value, as the zoom control.
            */}
            <span
              className="
                block rounded-xl border-2 border-gray-500 bg-white px-4 py-2.5 text-center
                text-sm font-bold text-gray-700 transition-all
                hover:border-gray-700 hover:bg-gray-50
                peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white
                peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2
              "
            >
              {option.label}
              {/*
                `peer-checked:` only reaches siblings of the input, and the hint sits a level
                deeper than that, so it takes its colour from the label above it instead.
              */}
              {option.hint && (
                <span className="mt-0.5 block text-xs font-medium text-current opacity-75">
                  {option.hint}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default SegmentedChoice;
