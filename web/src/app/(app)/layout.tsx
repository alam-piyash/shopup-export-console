"use client";
import { ProtectedLayout } from "@/components/AuthGate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
