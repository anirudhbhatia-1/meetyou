import { Banner, Button, Card } from '@meetyou/ui';

/** Web app sign-in, with the onboarding welcome copy (DESIGN §7.1, FR-ONB-02). */
export function SignIn({
  onSignIn,
  failed,
  busy,
}: {
  onSignIn: () => void;
  failed: boolean;
  busy: boolean;
}) {
  return (
    <main className="signin">
      <Card className="signin-card">
        <p className="wordmark">Minutes</p>
        <h1 className="display">Nothing joins your call.</h1>
        <p className="signin-body">
          Minutes listens from inside Chrome. It records two audio lanes — your microphone and the
          Meet tab — plus the Meet tab&rsquo;s video, and turns them into a transcript and notes.
        </p>
        <ul className="signin-rows">
          <li>
            <strong>Me</strong> — your microphone
          </li>
          <li>
            <strong>Them</strong> — the Meet tab
          </li>
          <li>
            <strong>Screen</strong> — what the Meet tab shows; you can turn it off
          </li>
          <li>
            <strong>Never used for training</strong>
          </li>
        </ul>
        {failed && <Banner tone="error">Sign-in didn&rsquo;t finish. Try again.</Banner>}
        <Button variant="primary" onClick={onSignIn} disabled={busy}>
          <GoogleMark /> {failed ? 'Try again' : 'Continue with Google'}
        </Button>
        <p className="meta small">Only your name and email.</p>
      </Card>
    </main>
  );
}

/** The standard Google "G" for sign-in buttons (Google sign-in branding guidelines). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden className="google-mark">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
