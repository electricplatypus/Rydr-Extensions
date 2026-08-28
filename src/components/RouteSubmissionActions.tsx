"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RouteSubmissionActions({ prNumber, name }: { prNumber: number; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const res = await fetch("/api/route-maps/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const reason = prompt(`Reject "${name}"? Optionally say why (shown as a comment on the PR):`, "");
    if (reason === null) return;
    setBusy("reject");
    setError(null);
    try {
      const res = await fetch("/api/route-maps/admin/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reject.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button className="btn text-xs" onClick={approve} disabled={busy !== null}>
          {busy === "approve" ? "Approving…" : "✅ Approve"}
        </button>
        <button className="btn secondary text-xs" onClick={reject} disabled={busy !== null}>
          {busy === "reject" ? "Rejecting…" : "✕ Reject"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
