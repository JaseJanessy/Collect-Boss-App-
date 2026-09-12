import { permanentRedirect } from "next/navigation";

export const metadata = {
  title: "CollectBoss",
  robots: { index: false, follow: false },
};

export default function BetaWelcomeRoute() {
  permanentRedirect("/");
}
