import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { ALLOWED_DOMAIN, ALLOWED_DOMAINS, isAllowedEmail, supabase } from "@/lib/supabase";
import { errMsg } from "@/lib/format";
import sceneSvg from "@/assets/login-scene.svg?raw";
import "./login-scene.css";
import { Logo } from "@/components/Logo";

const SCENE_ROOT = 'viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"';
// Mobile copies drop the full-page sky so they blend into the page background.
const BARE = sceneSvg
  .replace('<rect width="1440" height="900" fill="url(#bg)"/>', "")
  .replace(/<circle[^>]*class="lg-blob[12]"\/>/g, "");
// The port copy also drops the map layer (dots, routes, ports) so only port, sea, ship and plane remain.
const PORT_BASE = BARE.slice(0, BARE.indexOf('<path d="M528.2 92h0')) + BARE.slice(BARE.indexOf('<g class="lg-pw2">'));
const MAP_SVG = BARE.replace(SCENE_ROOT, 'viewBox="455 70 990 480" preserveAspectRatio="xMidYMid meet"');
const PORT_SVG = PORT_BASE.replace(SCENE_ROOT, 'viewBox="100 460 620 440" preserveAspectRatio="xMidYMax slice"');
const PORT_SVG_WIDE = PORT_BASE.replace(SCENE_ROOT, 'viewBox="0 430 1100 470" preserveAspectRatio="xMidYMax slice"');

function useWidth() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

const DOMAIN_MSG = `Only ${ALLOWED_DOMAIN} accounts can sign in. Please continue with your ShopUp Google account.`;

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";
  const [busy, setBusy] = useState(false);
  const width = useWidth();
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
        queryParams: ALLOWED_DOMAINS.length === 1 ? { hd: ALLOWED_DOMAINS[0], prompt: "select_account" } : { prompt: "select_account" },
      },
    });
    if (error) {
      setError(errMsg(error));
      setBusy(false);
    }
  }

  const card = (
    <div className="rounded-2xl border border-slate-400/20 bg-[#0a1428]/60 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-md sm:p-7">
      <h1 className="text-[22px] font-semibold tracking-tight text-white">Sign in</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-400">Use your ShopUp Google account to continue.</p>
      {error && (
        <div className="mt-5 flex gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-[13px] text-red-200">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-[11px] bg-white text-[14px] font-semibold text-slate-900 transition hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(96,165,250,0.3)] disabled:opacity-70"
      >
        {busy ? <Loader2 className="size-[18px] animate-spin" /> : <GoogleMark />}
        {busy ? "Redirecting..." : "Continue with Google"}
      </button>
      <p className="mt-3.5 text-center text-[11.5px] text-slate-500">Only {ALLOWED_DOMAIN} accounts can sign in.</p>
    </div>
  );

  const brand = <Logo size={36} onDark />;

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-[#050b18] text-slate-200">
      {width >= 1024 ? (
        <>
          {/* Desktop: one full-screen scene, card on the left */}
          <div className="absolute inset-0" aria-hidden dangerouslySetInnerHTML={{ __html: sceneSvg }} />
          <div className="absolute left-16 top-7 z-10">{brand}</div>
          <div className="absolute left-16 top-[clamp(96px,16vh,170px)] z-10 w-[360px]">{card}</div>
        </>
      ) : (
        /* Mobile and tablet: network on top, card in the middle, port and sea at the bottom */
        <div className="flex min-h-[100svh] flex-col bg-gradient-to-b from-[#050b18] via-[#0a1830] to-[#0c1d38]">
          <div className="px-5 pt-6">{brand}</div>
          <div className="relative mx-auto mt-4 aspect-[990/480] w-full max-w-2xl" aria-hidden dangerouslySetInnerHTML={{ __html: MAP_SVG }} />
          <div className="relative z-10 mx-auto -mt-2 w-full max-w-md px-4">{card}</div>
          <div className="min-h-6 flex-1" />
          {width < 640 ? (
            <div className="lg-m relative aspect-[620/440] max-h-[38svh] w-full" aria-hidden dangerouslySetInnerHTML={{ __html: PORT_SVG }} />
          ) : (
            <div className="relative aspect-[1100/470] w-full" aria-hidden dangerouslySetInnerHTML={{ __html: PORT_SVG_WIDE }} />
          )}
        </div>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9Z" />
    </svg>
  );
}
