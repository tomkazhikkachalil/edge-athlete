import { redirect } from 'next/navigation';

// Guessable-URL alias — the real sign-in page lives at "/". Two legacy
// in-app links also pointed here before this route existed.
export default function LoginAlias() {
  redirect('/');
}
