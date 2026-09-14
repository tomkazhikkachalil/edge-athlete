import { redirect } from 'next/navigation';

/** /sports → its first place. */
export default function SportsIndex() {
  redirect('/sports/explore');
}
