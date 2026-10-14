import { HomeView } from "./_components/HomeView";

/* Route: / (root). Thin entry — the redirect-to-first-repo / onboarding
   prompt lives in _components/HomeView. */
export default function HomePage() {
  return <HomeView />;
}
