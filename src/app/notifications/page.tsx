import { redirect } from 'next/navigation';

// The notifications page lives at /app/notifications (the route NotificationBell
// links to). This alias existed as a parallel, drifted implementation — the two
// were consolidated in July 2026; see DEVLOG.
export default function NotificationsRedirect() {
  redirect('/app/notifications');
}
