import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Coins, FileStack, ShieldAlert, Wallet } from "lucide-react";
import { ALLOWED_DOMAIN, isAllowedEmail, supabase } from "@/lib/supabase";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui";

const DOMAIN_MSG = `Only ${ALLOWED_DOMAIN} accounts can sign in. Please continue with your ShopUp Google account.`;

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") === "domain" ? DOMAIN_MSG : null);

  useEffect(() => {
    const raw = decodeURIComponent(window.location.hash + window.location.search);
    if (/error/i.test(raw) && /(shopup|database|saving new user|accounts can sign in)/i.test(raw)) setError(DOMAIN_MSG);
    else if (/error_description=([^&]+)/.test(raw)) setError(raw.match(/error_description=([^&]+)/)![1].replace(/\+/g, " "));
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      if (!isAllowedEmail(user.email)) {
        await supabase.auth.signOut();
        setError(DOMAIN_MSG);
        return;
      }
      navigate(from, { replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s?.user && isAllowedEmail(s.user.email)) navigate(from, { replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, from]);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/login",
        queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
      },
    });
    if (error) {
      setError(errMsg(error));
      setBusy(false);
    }
  }

  const menus = [
    { icon: ArrowLeftRight, t: "Trades", d: "Sales contracts, items and amendments with admin approval." },
    { icon: FileStack, t: "EXPs and documents", d: "One EXP per shipment. Six documents, auto close when final." },
    { icon: Wallet, t: "Collections", d: "Match money received against EXPs, to the taka." },
    { icon: Coins, t: "Incentives", d: "FOB based incentive claims from collected EXPs." },
  ];

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-40 -top-40 size-[32.5rem] rounded-full bg-accent/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 size-[26.25rem] rounded-full bg-ok/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-accent to-ok/80 text-[1rem] font-bold text-accent-fg">S</span>
          <div>
            <div className="text-[0.9375rem] font-semibold">ShopUp Export Console</div>
            <div className="lbl">Internal</div>
          </div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-[2.5rem] font-semibold leading-[1.1] tracking-tight">
            Every export, from contract to <span className="bg-gradient-to-r from-accent to-ok bg-clip-text text-transparent">incentive</span>.
          </h1>
          <div className="mt-10 grid gap-5">
            {menus.map((m) => (
              <div key={m.t} className="flex gap-3.5">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-bg text-accent">
                  <m.icon className="size-[1.125rem]" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-[0.875rem] font-medium">{m.t}</div>
                  <div className="text-[0.8438rem] text-mut">{m.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lbl relative">Internal tool for ShopUp teams</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-accent to-ok/80 text-[1rem] font-bold text-accent-fg">S</span>
            <div className="text-[1rem] font-semibold">ShopUp Export Console</div>
          </div>
          <div className="card p-7 shadow-2xl shadow-black/20">
            <h2 className="text-[1.375rem] font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-mut">Use your ShopUp Google account to continue.</p>
            {error && (
              <div className="banner chip-bad mt-5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button className="mt-6 w-full" onClick={signIn} loading={busy}>
              {!busy && <GoogleMark />}
              Continue with Google
            </Button>
            <p className="mt-4 text-center text-[0.75rem] text-mut">Only {ALLOWED_DOMAIN} accounts can sign in.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9Z" />
    </svg>
  );
}
