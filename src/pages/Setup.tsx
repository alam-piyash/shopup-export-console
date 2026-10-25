import { Settings } from "lucide-react";

/** Shown when the Supabase env vars are missing (e.g. first Vercel deploy). */
export default function Setup() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-lg p-8">
        <Settings className="mb-4 size-7 text-accent" />
        <h1 className="text-[1.375rem] font-semibold">Almost there</h1>
        <p className="mt-2 text-mut">
          This deployment is missing its Supabase settings. Add these environment variables in Vercel (Project settings, Environment Variables), then redeploy:
        </p>
        <pre className="num mt-4 overflow-x-auto rounded-lg border border-line bg-bg p-4 text-[0.7812rem] leading-6">
          VITE_SUPABASE_URL{"\n"}VITE_SUPABASE_ANON_KEY{"\n"}VITE_ALLOWED_DOMAIN
        </pre>
        <p className="mt-4 text-[0.8125rem] text-mut">See README.md in the project for the full setup steps.</p>
      </div>
    </div>
  );
}
