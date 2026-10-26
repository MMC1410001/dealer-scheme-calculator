"use client";

/** A <select> that submits its form when the value changes (the list reloads without a click on the button). */
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<"select">, "onChange"> & {
  /**
   * Names of form controls that do not apply after a change of this value (for example a slab filter of another
   * scheme). They are disabled before the submit, so the browser leaves them out of the request.
   */
  resetOnChange?: readonly string[];
};

export function AutoSubmitSelect({ resetOnChange, ...props }: Props) {
  return (
    <select
      {...props}
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        for (const name of resetOnChange ?? []) {
          for (const el of Array.from(form.elements)) {
            if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el !== e.currentTarget && el.name === name) el.disabled = true;
          }
        }
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      }}
    />
  );
}
