import { CreditBalance } from "@/features/credits/CreditsProvider";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from '@/features/brand/BrandMark';
import type { ReactNode } from "react";

/** Shared public/account shell; navigation does not create a second workspace. */
export function WebPageShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`glass-page ${className}`}>
      <nav className="glass-site-nav" aria-label="网站导航">
        <Link className="glass-brand" href="/home">
          <BrandMark />
          ZImage<span>创作空间</span>
        </Link>
        <Link href="/create">
          探索电商创作 <ArrowUpRight size={15} aria-hidden />
        </Link>
        <CreditBalance />
      </nav>
      {children}
    </main>
  );
}
