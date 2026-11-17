"use client";
/**
 * Small routing layer over next/navigation with the API the screens were written against
 * (react-router style): Link, NavLink, Navigate, useNavigate, useParams, useSearchParams, useLocation.
 */
import NextLink from "next/link";
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from "next/navigation";
import { forwardRef, useCallback, useEffect, type AnchorHTMLAttributes, type ReactNode } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; replace?: boolean; children?: ReactNode };

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, replace, ...rest }, ref) {
  return <NextLink ref={ref} href={to} replace={replace} {...rest} />;
});

type NavLinkProps = Omit<LinkProps, "className"> & { end?: boolean; className?: string | ((s: { isActive: boolean }) => string) };

export function NavLink({ to, end, className, ...rest }: NavLinkProps) {
  const path = usePathname() ?? "/";
  const isActive = end || to === "/" ? path === to : path === to || path.startsWith(to.endsWith("/") ? to : to + "/");
  const cls = typeof className === "function" ? className({ isActive }) : className;
  return <Link to={to} className={cls} aria-current={isActive ? "page" : undefined} {...rest} />;
}

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: string | number, opts?: { replace?: boolean }) => {
      if (typeof to === "number") {
        if (to < 0) router.back();
        else router.forward();
        return;
      }
      if (opts?.replace) router.replace(to);
      else router.push(to);
    },
    [router],
  );
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  return null;
}

/** Route parameters as plain strings. */
export function useParams<T extends Record<string, string> = Record<string, string>>(): Partial<T> {
  const p = useNextParams() ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? v.join("/") : String(v);
  return out as Partial<T>;
}

type SetParams = (next: Record<string, string> | URLSearchParams, opts?: { replace?: boolean }) => void;

export function useSearchParams(): [URLSearchParams, SetParams] {
  const sp = useNextSearchParams();
  const router = useRouter();
  const path = usePathname() ?? "/";
  const params = new URLSearchParams(sp?.toString() ?? "");
  const set: SetParams = (next, opts) => {
    const q = new URLSearchParams(next as Record<string, string>).toString();
    const url = q ? `${path}?${q}` : path;
    if (opts?.replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };
  return [params, set];
}

export function useLocation() {
  const pathname = usePathname() ?? "/";
  const sp = useNextSearchParams();
  const search = sp?.toString() ? `?${sp.toString()}` : "";
  return { pathname, search };
}
