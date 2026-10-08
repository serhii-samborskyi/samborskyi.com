'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="simple-page">
      <div className="eyebrow accent">A SMALL INTERRUPTION</div>
      <h1>Let’s try that again.</h1>
      <p>The listening room hit a temporary problem.</p>
      <button className="button button-accent" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
