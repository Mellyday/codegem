"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { href: "/", label: "Home" },
    { href: "/import", label: "Import" },
];

export default function Navbar() {
    const pathname = usePathname();

    return (
        <nav className="flex items-center gap-1">
            {navItems.map((item) => {
                const isActive = pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
              ${isActive
                                ? "bg-rose-100 text-rose-700"
                                : "text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                            }`}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
