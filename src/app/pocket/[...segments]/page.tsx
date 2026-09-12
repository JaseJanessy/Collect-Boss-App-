import { notFound } from "next/navigation";
import { PocketPlaceholder } from "@/components/pocket/pocket-placeholder";
import { pocketDestinationForPath } from "@collectboss/pocket-navigation";

export default async function PocketDestinationPage({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  const destination = pocketDestinationForPath(`/pocket/${segments.join("/")}`);
  if (!destination) notFound();
  return <PocketPlaceholder destination={destination} />;
}
