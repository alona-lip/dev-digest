/* Route-segment error boundary: a render/runtime error in any page lands here
   instead of blanking the app. The root layout (providers, i18n) is still
   mounted, so the shell stays usable; `reset` re-renders the segment. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");

  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorState fullScreen title={t("states.error")} body={t("errorBoundary.body")} onRetry={reset} />;
}
