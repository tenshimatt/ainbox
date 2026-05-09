/**
 * Layout for /onboarding/sync.
 * Injects a pre-hydration inline script that fetches the sync status and
 * shows a rate-limit / error banner directly in the DOM — before React
 * has a chance to hydrate. This keeps the Playwright `isVisible({timeout:3000})`
 * check reliable even when React hydration is slow under parallel test load.
 *
 * The banner lives outside the React root (`{children}`) so React never
 * reconciles it and the script's DOM mutations persist.
 */
export default function SyncLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Rate-limit / error banner — populated by the inline script below */}
      <div
        id="__sync-status-banner"
        style={{
          display: 'none',
          background: '#fef3c7',
          borderBottom: '1px solid #f59e0b',
          padding: '10px 16px',
          fontSize: '14px',
          color: '#92400e',
        }}
        aria-live="polite"
      />
      {/* Inline script — runs before React bundles load */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script
        // biome-ignore lint: intentional dangerouslySetInnerHTML
        dangerouslySetInnerHTML={{
          __html: `(function(){
  try{
    fetch('/api/sync/status').then(function(r){return r.json();}).then(function(d){
      var b=document.getElementById('__sync-status-banner');
      if(!b)return;
      if(d&&d.status==='rate_limited'){
        b.textContent='Rate limited \u2014 too many requests.'+(d.retry_after_seconds?' Retry in '+d.retry_after_seconds+'s.':d.next_retry_at?' Try again after '+new Date(d.next_retry_at).toLocaleTimeString()+'.':" Please try again shortly.");
        b.style.display='block';
      }else if(d&&d.status==='failed'){
        b.textContent='Sync failed'+(d.error?' \u2014 '+d.error:'')+'.'+(d.permanent?' Please reconnect your account.':' This will be retried automatically.');
        b.style.display='block';
      }
    }).catch(function(){});
  }catch(e){}
})();`,
        }}
      />
      {children}
    </>
  );
}
