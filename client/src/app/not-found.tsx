/* 404 for unknown routes and for `notFound()` (e.g. /settings/<unknown>). */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export default function NotFound() {
  const t = useTranslations("common");
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 32 }}>
      <div>
        <EmptyState icon="Search" title={t("notFound.title")} body={t("notFound.body")} />
        <p style={{ textAlign: "center", marginTop: 16 }}>
          <Link href="/" style={{ color: "var(--accent-text)" }}>
            {t("notFound.home")}
          </Link>
        </p>
      </div>
    </div>
  );
}
