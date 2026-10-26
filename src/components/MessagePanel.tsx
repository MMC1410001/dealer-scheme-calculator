import { AlertIcon, InfoIcon } from "@/components/icons";

/** Friendly full-width message (session expired, no data, error). Never shows technical details. */
export function MessagePanel({ title, children, tone = "info" }: { title: string; children?: React.ReactNode; tone?: "info" | "warning" }) {
  const Icon = tone === "warning" ? AlertIcon : InfoIcon;
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <div
        role={tone === "warning" ? "alert" : "status"}
        className={`flex items-start gap-3 rounded-xl border px-4 py-4 ${
          tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-gray-200 bg-gray-50 text-gray-800"
        }`}
      >
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          {children ? <div className="mt-1 text-sm">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
