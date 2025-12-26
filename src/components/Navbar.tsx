"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { href: "/", label: "Home" },
    { href: "/import", label: "GitHub Import" },
];

// Dev-only navigation items
const devNavItems = [
    { href: "/dev/push-test", label: "Push Test" },
    { href: "/dev/distractor-debug", label: "Distractor Debug" },
];

export default function Navbar() {
    const pathname = usePathname();
    const isDev = process.env.NODE_ENV === "development";

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

            {/* Dev-only nav items */}
            {isDev && (
                <>
                    <span className="mx-1 text-slate-300">|</span>
                    {devNavItems.map((item) => {
                        const isActive = pathname === item.href ||
                            pathname.startsWith(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${isActive
                                        ? "bg-amber-100 text-amber-700"
                                        : "text-slate-500 hover:bg-amber-50 hover:text-amber-600"
                                    }`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </>
            )}
        </nav>
    );
}
