export default function UnauthorizedPage() {
  return (
    <main className="min-h-[60vh] grid place-items-center p-8 text-center bg-gradient-to-b from-cyan-50 via-teal-50/80 to-emerald-50/60">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-cyan-700">Access denied</h1>
        <p className="text-cyan-600/80 max-w-md">
          This app is restricted to the owner account. If you believe this is a
          mistake, sign out and try another account.
        </p>
      </div>
    </main>
  );
}
