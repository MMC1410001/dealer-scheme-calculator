import { SCHEME_TERMS } from "@/config/scheme-terms";
import { ChevronDownIcon } from "@/components/icons";

/** Collapsed "Scheme terms and conditions" from the circular (native details element: works without the page script). */
export function SchemeTerms({ tag, circularRef }: { tag: string; circularRef?: string | null }) {
  const sections = SCHEME_TERMS[tag];
  if (!sections || sections.length === 0) return null;
  return (
    <details className="group rounded-md border border-gray-200 bg-gray-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-brand-green/50 [&::-webkit-details-marker]:hidden">
        Scheme terms and conditions
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-gray-200 px-3 py-3 text-sm text-gray-800">
        {sections.map((s) => (
          <section key={s.title}>
            <h4 className="mb-1 font-semibold text-gray-900">{s.title}</h4>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {s.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-gray-500">
          {circularRef ? `Circular ${circularRef}. ` : ""}Only the terms that affect the calculation and the payout are shown here.
        </p>
      </div>
    </details>
  );
}
