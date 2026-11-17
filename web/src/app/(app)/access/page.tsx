"use client";
import Access from "@/views/Access";
import { AdminOnly } from "@/components/AuthGate";

export default function Page() {
  return (
    <AdminOnly>
      <Access />
    </AdminOnly>
  );
}
