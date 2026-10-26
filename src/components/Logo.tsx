import { cn } from "./ui";

/** ShopUp Export app icon: flag, cargo box and hull on a navy tile. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#1B2240" />
      <path d="M25.6 7.6 L40.9 16.6 L25.6 25.6 Z" fill="#F2EDE4" />
      <rect x="25" y="29.4" width="14" height="14" fill="#F28C38" />
      <path d="M12.8 38.2 A19.2 19.2 0 0 0 51.2 38.2 L44.5 38.2 A12.5 12.5 0 0 1 19.5 38.2 Z" fill="#2BB5A6" />
    </svg>
  );
}

/** Icon plus the "ShopUp / EXPORT" wordmark. */
export function Logo({ size = 32, className, onDark }: { size?: number; className?: string; onDark?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className="flex flex-col leading-none">
        <span className={cn("text-[1.0625rem] font-extrabold tracking-[-0.03em]", onDark ? "text-white" : "text-fg")}>ShopUp</span>
        <span className={cn("mt-[3px] text-[0.5625rem] font-semibold tracking-[0.42em]", onDark ? "text-[#F28C38]" : "text-[#B5541A] dark:text-[#F28C38]")}>EXPORT</span>
      </span>
    </span>
  );
}
