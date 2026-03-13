"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WaitForData({ assemblyId, slug }: { assemblyId: string; slug: string }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/assemblies/${assemblyId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.parsed_data) {
        clearInterval(interval);
        router.refresh();
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [assemblyId, slug, router]);

  return (
    <div className="standalone-page">
      <div className="standalone-page-inner" style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          Finalizing your panel
        </h1>
        <p style={{ color: "var(--color-text-secondary)" }}>
          Almost there...
        </p>
      </div>
    </div>
  );
}
