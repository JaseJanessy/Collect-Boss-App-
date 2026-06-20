import { BetaWelcomePage } from "@/components/pages/beta-welcome-page";

export const metadata = {
  title: "Welcome to CollectBoss Beta",
  description: "You are in the private beta. Get started with CollectBoss.",
};

export default function BetaWelcomeRoute() {
  return <BetaWelcomePage />;
}
