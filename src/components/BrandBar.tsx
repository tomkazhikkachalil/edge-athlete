import Image from 'next/image';

// Shared brand bar for logged-out / standalone pages (login, signup,
// onboarding, password flows, contact, legal). Non-interactive by design —
// these pages should not navigate away via the logo.
export default function BrandBar() {
  return (
    <div className="w-full bg-white border-b border-violet-100 py-3 px-4 flex justify-center">
      <h1 className="sr-only">Edge Athlete</h1>
      <Image
        src="/logo.png"
        alt="Edge Athlete"
        width={180}
        height={45}
        priority
        className="h-8 sm:h-9 w-auto"
      />
    </div>
  );
}
