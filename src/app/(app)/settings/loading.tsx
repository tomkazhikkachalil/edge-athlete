import RouteLoading from '@/components/RouteLoading';

/** Shown by Next while settings's route chunk and payload stream in — the same view the page shows while it fetches (PR I, Nov 4 2026). */
export default function Loading() {
  return <RouteLoading message="Loading..." />;
}
