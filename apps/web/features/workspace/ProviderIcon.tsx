/** Application-drawn provider marks from the approved v18 presentation.
 * Provider IDs remain the runtime's IDs; unknown providers use a neutral mark. */
export function ProviderIcon({ provider }: { provider: string }) {
  const bytedance = ['doubao', 'seedream', 'bytedance'].includes(provider);
  return <svg className="model-provider-icon" data-provider={bytedance ? 'bytedance' : provider}
    viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {bytedance ? <>
      <path d="M12 21V10M12 13C5 13 3 9 3 4c6 0 9 3 9 9Zm0-3c0-5 3-7 8-7 0 5-3 7-8 7Z" />
      <path d="m8 21 4-2 4 2" />
    </> : <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="m8 14 4-6 4 6M10 12h4" /></>}
  </svg>;
}
