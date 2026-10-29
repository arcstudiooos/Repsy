import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Pilot allowance: invited + active clients against the limit. Informational only (no payment UI). */
export function PilotAccessCard({ count, limit }: { count: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Pilot access · {count} of {limit} active clients
        </CardTitle>
        <CardDescription>
          Invited and active clients count toward your pilot limit. Paused and archived clients do
          not.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="progressbar"
          aria-label="Active clients used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(count, limit)}
          className="h-2 w-full overflow-hidden rounded-full bg-canvas"
        >
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}
