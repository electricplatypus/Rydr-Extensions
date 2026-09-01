import Link from "next/link";
import { listPendingSubmissions } from "@/lib/routeMaps";
import { RouteSubmissionActions } from "@/components/RouteSubmissionActions";

export const dynamic = "force-dynamic";

export default async function RouteMapsAdminPage() {
  const pending = await listPendingSubmissions();

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Route Approvals</h1>
        <Link href="/admin" className="btn secondary text-sm">
          ← Admin
        </Link>
      </div>
      <p className="text-[var(--text-muted)] mb-8">
        Approve or reject route-map submissions from the RydR Route Exchange plugin without leaving this page
        &mdash; approving merges the submission&rsquo;s pull request and marks the route live; rejecting closes
        the PR without merging. Nothing here needs a GitHub login.
      </p>

      {pending.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No pending submissions.</p>
      ) : (
        <div className="card divide-y divide-[var(--border-subtle)]">
          {pending.map(({ prNumber, prUrl, entry }) => (
            <div key={prNumber} className="flex items-start justify-between gap-4 p-3">
              <div>
                <div className="font-medium">
                  {entry.name}
                  {entry.region ? <span className="text-[var(--text-muted)]"> — {entry.region}</span> : null}
                </div>
                {entry.description && <div className="text-sm text-[var(--text-muted)] mt-0.5">{entry.description}</div>}
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {entry.category} • {entry.distanceMi} mi ({entry.pointCount} pts)
                  {entry.experience ? ` • ${entry.experience}/5 drive enjoyment` : ""}
                  {entry.photos?.length ? ` • ${entry.photos.length} photo${entry.photos.length === 1 ? "" : "s"}` : ""}
                  {" • "}
                  {entry.sourceType}
                  {entry.sourceUrl ? (
                    <>
                      {" "}
                      —{" "}
                      <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                        source
                      </a>
                    </>
                  ) : null}
                  {" • "}by {entry.author}
                  {" • "}
                  <a href={prUrl} target="_blank" rel="noreferrer" className="underline">
                    PR #{prNumber}
                  </a>
                </div>
                {entry.tags.length > 0 && (
                  <div className="text-xs text-[var(--text-muted)] mt-1">tags: {entry.tags.join(", ")}</div>
                )}
              </div>
              <RouteSubmissionActions prNumber={prNumber} name={entry.name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
