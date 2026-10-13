import type { Metadata } from "next";
import Link from "next/link";
import SharedTour from "@/components/SharedTour";
import { decodeShare } from "@/lib/tour/share";

/**
 * /t/<payload>: a read-only tour plan carried entirely in the URL (lz-string). Nothing is stored server-side;
 * the page renders what the link holds: names, scores and labels, never Qloo entity ids or raw responses.
 */

export async function generateMetadata({ params }: { params: Promise<{ payload: string }> }): Promise<Metadata> {
  const { payload } = await params;
  const p = decodeShare(payload);
  return { title: p ? `${p.act.name} - ${p.stops.length}-stop tour | Tour Router` : "Tour Router - shared tour", description: p ? `${p.stops.map((s) => s.city).join(" -> ")} (${p.startDate} to ${p.endDate}), routed by taste with Qloo.` : "Shared tour plan" };
}

export default async function SharedTourPage({ params }: { params: Promise<{ payload: string }> }) {
  const { payload } = await params;
  const p = decodeShare(payload);
  if (!p) {
    return (
      <div className="mx-auto max-w-xl p-6 text-sm">
        <h1 className="text-lg font-semibold">This share link is not readable</h1>
        <p className="mt-2 text-muted">The link is incomplete or was made by a different version of Tour Router. Open the studio and share the plan again.</p>
        <Link className="mt-3 inline-block underline" href="/">
          Open the studio
        </Link>
      </div>
    );
  }
  return <SharedTour p={p} />;
}
