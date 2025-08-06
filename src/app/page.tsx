export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm">
        <h1 className="mb-4 text-4xl font-bold">Your first web application</h1>
        
        <p className="mb-8">
          This starter template includes the following pre-built services:
        </p>

        <div className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Available endpoints:</h2>
          <ul className="list-disc list-inside space-y-1">
            <li><code>POST /api/ai/text</code> - AI text processing</li>
            <li><code>POST /api/ai/image</code> - AI image analysis</li>
            <li><code>POST /api/contact</code> - Send emails</li>
          </ul>
        </div>

        <p>
          Replace this page with your own content.
        </p>
      </div>
    </main>
  );
}