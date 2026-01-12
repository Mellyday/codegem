"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code2, Github, FlaskConical, Bug } from "lucide-react";

type NavItem = {
    href: string;
    label: string;
    icon: React.ReactNode;
};

const navItems: NavItem[] = [
    { href: "/", label: "Home", icon: <Code2 className="w-4 h-4" /> },
    { href: "/import", label: "GitHub Import", icon: <Github className="w-4 h-4" /> },
];

// Dev-only navigation items
const devNavItems: NavItem[] = [
    { href: "/dev/push-test", label: "Push Test", icon: <FlaskConical className="w-4 h-4" /> },
    { href: "/dev/distractor-debug", label: "Distractor Debug", icon: <Bug className="w-4 h-4" /> },
];

export default function Navbar() {
    const pathname = usePathname();
    const isDev = process.env.NODE_ENV === "development";

    // Combine nav items - in dev mode, show all items together
    const allItems = isDev ? [...navItems, ...devNavItems] : navItems;

    return (
        <nav className="flex items-center gap-1">
            {allItems.map((item) => {
                const isActive = pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors
                            ${isActive
                                ? "bg-blue-50 text-blue-600"
                                : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                            }`}
                    >
                        {item.icon}
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
