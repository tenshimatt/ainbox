export default function OnboardingCompletePage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="rounded-lg border border-green-200 bg-green-50 p-8">
        <h1 className="text-2xl font-bold text-green-900">You&rsquo;re all set!</h1>
        <p className="mt-4 text-sm text-green-800">
          Onboarding complete. Your knowledge base is being built and your inbox is ready.
          Check your email for a confirmation.
        </p>
        <a
          href="/dashboard"
          className="mt-6 inline-block rounded bg-green-700 px-6 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          Go to Dashboard
        </a>
      </div>
    </main>
  );
}
