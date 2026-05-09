export default function DpaPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Data Processing Agreement</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: May 2026</p>

      <div className="mt-8 space-y-6 text-sm text-slate-700">
        <section>
          <h2 className="text-lg font-semibold text-slate-900">1. Scope</h2>
          <p className="mt-2">This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the Terms of Service between Beyond Pandora Ltd (&ldquo;Data Processor&rdquo;) and the customer (&ldquo;Data Controller&rdquo;). It governs the processing of personal data by Ainbox on behalf of the customer in accordance with GDPR Article 28 (Regulation (EU) 2016/679).</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">2. Data Processing Details</h2>
          <p className="mt-2">Subject matter: Provision of AI-powered email inbox management services. Duration: For the term of the subscription agreement. Nature and purpose: Email classification, AI draft generation, knowledge base extraction. Categories of data: Email metadata and content, contact information. Data subjects: The customer&rsquo;s email correspondents.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">3. Processor Obligations</h2>
          <p className="mt-2">We will process personal data only on documented instructions from the Data Controller. We ensure that persons authorised to process personal data have committed to confidentiality. We implement appropriate technical and organisational security measures as described in our Security page.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">4. Sub-processors</h2>
          <p className="mt-2">We use the following sub-processors: Supabase Inc. (database, authentication, storage &mdash; USA/EU); Vercel Inc. (hosting &mdash; USA/EU). We will notify customers of any intended changes concerning sub-processors and give the opportunity to object.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">5. Contact</h2>
          <p className="mt-2">
            To request a signed DPA for your organisation,{' '}
            <a href="mailto:legal@ainbox.io" className="underline text-blue-700">
              contact our legal team
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
