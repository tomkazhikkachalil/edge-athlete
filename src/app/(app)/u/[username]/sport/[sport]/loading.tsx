import RouteLoading from '@/components/RouteLoading';

/** Shown by Next while the sport profile's route chunk streams in — the same view the page shows while it fetches. */
export default function Loading() {
  return <RouteLoading message="Loading sport profile..." />;
}
