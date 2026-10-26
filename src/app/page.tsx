import Link from "next/link";

/** Minimal landing page. It shows no dealer data. */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Scheme Calculator</h1>
      <p className="text-gray-600">
        Dealers open their scheme status from DMS or SFA. Staff use the admin area for the report and dealer support.
      </p>
      <p>
        <Link
          href="/admin"
          className="inline-flex rounded-md bg-brand-green-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green-dark"
        >
          Go to admin
        </Link>
      </p>
    </main>
  );
}
