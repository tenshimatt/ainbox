export default function OnboardingCompletePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 max-w-full overflow-x-hidden">
      <h1 className="text-2xl font-semibold mb-4">Setup Complete</h1>
      <p className="text-muted-foreground mb-6 text-center">
        Your inbox is ready. A confirmation email has been sent.
      </p>
      <a
        href="/dashboard"
        className="inline-block rounded bg-primary px-6 py-2 text-primary-foreground hover:opacity-90"
      >
        Go to Inbox
      </a>
    </main>
  );
}
