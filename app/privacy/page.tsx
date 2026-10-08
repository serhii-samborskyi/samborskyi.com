import Link from 'next/link';
export const metadata = { title: 'Privacy note' };
export default function Privacy() {
  return (
    <main className="simple-page">
      <Link href="/" className="text-link">
        ← Back to the listening room
      </Link>
      <div className="eyebrow accent">A LITTLE CLARITY</div>
      <h1>
        Your listening.
        <br />
        Your choices.
      </h1>
      <p>
        This is the independent music space of Serhii Samborskyi. Here’s what the site stores and
        why.
      </p>
      <h2>Keeping you in the loop</h2>
      <p>
        Email subscriptions store your email address and confirmation status. You become a
        subscriber only after confirming your email. Each release email includes an unsubscribe
        link. Pending, unconfirmed subscriptions are removed after seven days when the background
        worker is running.
      </p>
      <p>
        Telegram subscriptions store your private chat ID after you send /start to the studio bot.
        Send /stop to stop updates. Browser notifications store your browser’s push subscription,
        which you can remove in the Push tab or in your browser settings. These channels are
        independent: unsubscribing from one does not affect another.
      </p>
      <h2>Understanding what resonates</h2>
      <p>
        If you allow listening analytics, this site creates a random browser identifier and records
        page visits, plays, 30 seconds of actual listening, completed tracks, and subscriptions.
        This is used for aggregate studio statistics. It does not record your email with your
        listening history. Analytics events are removed after 90 days by the background worker.
      </p>
      <h2>Helping the music find its people</h2>
      <p>
        If you allow marketing and the Meta Pixel is connected, Meta receives page views, track
        views, engaged listening, track completions, and subscription events. Meta may associate
        these events with its own identifiers to measure advertising and create audiences, including
        similar audiences. No email address or Telegram chat ID is explicitly sent to the Pixel by
        this site.
      </p>
      <p>
        Meta’s handling of that information is described in its{' '}
        <a
          href="https://www.facebook.com/privacy/policy/"
          target="_blank"
          rel="noopener noreferrer"
        >
          privacy policy
        </a>
        . Optional analytics and the Pixel are disabled until you opt in.
      </p>
      <h2>You can change your mind</h2>
      <p>
        Choose “Cookie choices” in the listening room’s footer to change or withdraw optional
        consent. Your choice is saved on this device for 180 days. Withdrawing consent stops future
        optional tracking; it does not undo data already sent to a provider. Music and subscriptions
        work without optional cookies.
      </p>
      <h2>What keeps the studio running</h2>
      <p>
        Essential storage includes your privacy choices, an authentication cookie for the private
        studio, and subscription records. Short-lived, hashed request identifiers protect the forms
        from abuse. Uploaded audio and release information are public only after publishing. Drafts
        and subscriber data require studio authentication.
      </p>
      <p>
        When configured, email is delivered through Resend, Telegram updates through Telegram, and
        push messages through your browser’s notification provider. Subscriptions are retained while
        you stay subscribed. Unsubscribed records are kept to prevent accidental delivery and to
        preserve delivery history.
      </p>
      <h2>Contact and removal</h2>
      <p>
        Reply to a release email to contact Serhii about your subscription or request deletion of
        your subscription record. You can stop updates immediately using the unsubscribe controls
        described above.
      </p>
      <Link href="/" className="button">
        Back to the music ↗
      </Link>
    </main>
  );
}
