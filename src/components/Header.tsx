"use client";
import Link from "next/link";

export default function Header() {
  return (
    <header className="p-2 flex gap-2 bg-white text-black justify-between">
      <nav className="flex flex-row">
        <div className="px-2 font-bold">
          <Link href="/">Home</Link>
        </div>
      </nav>
    </header>
  );
}
