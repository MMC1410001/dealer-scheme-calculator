import type { SchemeStatus } from "@/engine/types";
import { InfoIcon } from "@/components/icons";
import { reasonText } from "./helpers";

export function NotInScopeCard({ scheme, name }: { scheme: SchemeStatus; name: string | null }) {
  return (
    <article className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3" aria-label={`${name ?? scheme.scheme_tag}: not in scheme`}>
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">
          {name ?? scheme.scheme_tag} <span className="font-normal text-gray-500">({scheme.scheme_tag})</span>
        </p>
        <p className="text-sm text-gray-600">{reasonText(scheme)}</p>
      </div>
    </article>
  );
}
