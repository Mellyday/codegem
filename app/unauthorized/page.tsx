export default function UnauthorizedPage() {
  return (
    <main className="min-h-[60vh] grid place-items-center p-8 text-center">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-rose-700">Access denied</h1>
        <p className="text-rose-500 max-w-md">
          This app is restricted to the owner account. If you believe this is a
          mistake, sign out and try another account.
        </p>
      </div>
    </main>
  );
}
