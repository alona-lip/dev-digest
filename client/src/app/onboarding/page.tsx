import type { Metadata } from "next";
import { AddRepoView } from "./_components/AddRepoView";

/* Add-repository route — /onboarding. Thin server entry; the (client) screen
   lives in _components/AddRepoView. */

export const metadata: Metadata = { title: "Add a repository" };

export default function AddRepoPage() {
  return <AddRepoView />;
}
