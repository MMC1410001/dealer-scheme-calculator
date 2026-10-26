import { LockIcon, UnlockIcon } from "@/components/icons";

export function LockBadge({ status }: { status: "UNLOCKED" | "LOCKED" }) {
  if (status === "UNLOCKED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-green-dark px-2.5 py-0.5 text-xs font-semibold text-white">
        <UnlockIcon className="h-3.5 w-3.5" />
        Unlocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 ring-1 ring-gray-200 ring-inset">
      <LockIcon className="h-3.5 w-3.5" />
      Locked
    </span>
  );
}
