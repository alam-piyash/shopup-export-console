"use client";
import { Navigate } from "@/lib/router";

/** Unknown paths go to the dashboard, as before. */
export default function NotFound() {
  return <Navigate to="/" replace />;
}
