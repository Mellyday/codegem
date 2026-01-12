"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code2, Github, FlaskConical, Bug, Calendar, Menu, X } from "lucide-react";

type NavItem = {
    href: string;
    label: string;
    icon: React.ReactNode;
};

const navItems: NavItem[] = [
    { href: "/", label: "Home", icon: <Code2 className="w-4 h-4" /> },
    { href: "/import", label: "GitHub Import", icon: <Github className="w-4 h-4" /> },
    { href: "/review", label: "Review", icon: <Calendar className="w-4 h-4" /> },
];

// Dev-only navigation items
const devNavItems: NavItem[] = [
    { href: "/dev/push-test", label: "Push Test", icon: <FlaskConical className="w-4 h-4" /> },
    { href: "/dev/distractor-debug", label: "Distractor Debug", icon: <Bug className="w-4 h-4" /> },
];

export default function Navbar() {
    const pathname = usePathname();
    const isDev = process.env.NODE_ENV === "development";
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Combine nav items - in dev mode, show all items together
    const allItems = isDev ? [...navItems, ...devNavItems] : navItems;

    return (
        <>
            {/* Desktop navigation */}
            <nav className="hidden md:flex items-center gap-1">
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

            {/* Mobile hamburger button */}
            <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="md:hidden p-2 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Open menu"
            >
                <Menu className="w-5 h-5" />
            </button>

            {/* Mobile menu overlay */}
            {mobileMenuOpen && (
                <div
                    className="fixed inset-0 z-50 bg-black/50 md:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                >
                    {/* Slide-out drawer */}
                    <div
                        className="absolute top-0 right-0 h-full w-64 bg-white shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Drawer header */}
                        <div className="flex items-center justify-between p-4 border-b border-slate-200">
                            <span className="font-semibold text-slate-900">Menu</span>
                            <button
                                type="button"
                                onClick={() => setMobileMenuOpen(false)}
                                className="p-2 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                aria-label="Close menu"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Drawer links */}
                        <nav className="flex flex-col p-4 gap-1">
                            {allItems.map((item) => {
                                const isActive = pathname === item.href ||
                                    (item.href !== "/" && pathname.startsWith(item.href));

                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className={`flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-md transition-colors
                                            ${isActive
                                                ? "bg-blue-50 text-blue-600"
                                                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                            }`}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            )}
        </>
    );
}
