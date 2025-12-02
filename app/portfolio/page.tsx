"use client";

import React, { useState, useEffect } from "react";

// --- Types ---
type Tab = "projects" | "interests" | "tinkering";
type ProjectCategory = "fullstack" | "backend" | "ml";

// --- Data ---
const ASCII_FACE = `
      .g8""8q.
    .dP'    \`YM.
  d8'        \`mb
  88          88
  Y8.        .8P
   \`Mb.    .dM'
     \`"bmmd"'
`;

const COPYWRITING = {
    hero: "Welcome to the digital archive. I build things that live on the internet.",
    intro: "Initializing user session... Access granted. Level 3 clearance recognized.",
};

const PROJECTS = {
    fullstack: [
        { title: "Nexus Dashboard", desc: "Real-time analytics platform with Next.js & Supabase" },
        { title: "Retro Chat", desc: "Websocket-based IRC clone with modern UI" },
    ],
    backend: [
        { title: "Go-Micro", desc: "Microservices framework written in Go" },
        { title: "Cache-DB", desc: "In-memory key-value store with persistence" },
    ],
    ml: [
        { title: "Vision-Net", desc: "Convolutional Neural Network for object detection" },
        { title: "Predictor-X", desc: "Time-series forecasting model for stock data" },
    ],
};

const INTERESTS = [
    "System Architecture",
    "Vintage Computing",
    "Neural Networks",
    "Mechanical Keyboards",
    "Cybersecurity",
];

const TINKERING = [
    { title: "Arduino Weather Station", status: "Online" },
    { title: "Home Lab Server Rack", status: "Maintenance" },
    { title: "Custom 60% Keyboard Build", status: "Complete" },
];

// --- Components ---

const Scanlines = () => (
    <div className="pointer-events-none fixed inset-0 z-50 h-full w-full bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-20" />
);

const CrtFlicker = () => (
    <div className="pointer-events-none fixed inset-0 z-40 h-full w-full animate-flicker bg-white opacity-[0.02]" />
);

const GlitchText = ({ text }: { text: string }) => {
    return (
        <span className="relative inline-block group">
            <span className="relative z-10">{text}</span>
            <span className="absolute left-0 top-0 -z-10 translate-x-[2px] text-red-500 opacity-0 group-hover:opacity-70 animate-pulse">
                {text}
            </span>
            <span className="absolute left-0 top-0 -z-10 -translate-x-[2px] text-blue-500 opacity-0 group-hover:opacity-70 animate-pulse delay-75">
                {text}
            </span>
        </span>
    );
};

export default function PortfolioPage() {
    const [activeTab, setActiveTab] = useState<Tab>("projects");
    const [projectCategory, setProjectCategory] = useState<ProjectCategory>("fullstack");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    return (
        <div className="min-h-screen bg-black font-mono text-green-500 selection:bg-green-500 selection:text-black overflow-x-hidden">
            <Scanlines />
            <CrtFlicker />

            <main className="relative z-10 mx-auto max-w-4xl px-6 py-12">
                {/* Header / Hero */}
                <header className="mb-16 flex flex-col items-center justify-center space-y-8 border-b-2 border-green-900 pb-12 md:flex-row md:space-x-12 md:space-y-0">
                    <div className="whitespace-pre font-bold leading-none tracking-tighter text-green-400 opacity-80 hover:opacity-100 transition-opacity duration-300">
                        {ASCII_FACE}
                    </div>
                    <div className="flex-1 text-center md:text-left">
                        <h1 className="mb-4 text-4xl font-bold uppercase tracking-widest text-green-400 text-shadow-glow">
                            <GlitchText text="System_Admin" />
                        </h1>
                        <p className="mb-4 text-lg leading-relaxed text-green-300/90">
                            {COPYWRITING.hero}
                        </p>
                        <p className="text-sm text-green-700 animate-pulse">
                            {">"} {COPYWRITING.intro}
                            <span className="inline-block w-2 h-4 ml-1 align-middle bg-green-500 animate-blink" />
                        </p>
                    </div>
                </header>

                {/* Navigation Tabs */}
                <nav className="mb-12 flex flex-wrap justify-center gap-4 md:justify-start">
                    {(["projects", "interests", "tinkering"] as Tab[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-2 text-lg font-bold uppercase tracking-wider transition-all duration-200 border-2 
                ${activeTab === tab
                                    ? "border-green-500 bg-green-500/10 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                                    : "border-green-900 text-green-700 hover:border-green-700 hover:text-green-500"
                                }`}
                        >
                            [{tab}]
                        </button>
                    ))}
                </nav>

                {/* Content Area */}
                <section className="min-h-[400px] border-l-2 border-green-900 pl-6 md:pl-12">

                    {/* PROJECTS TAB */}
                    {activeTab === "projects" && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-8 flex gap-4 text-sm">
                                {(["fullstack", "backend", "ml"] as ProjectCategory[]).map((cat) => (
                                    <button
                                        key={cat}
                                        onClick={() => setProjectCategory(cat)}
                                        className={`uppercase transition-colors ${projectCategory === cat
                                                ? "text-green-400 underline underline-offset-4"
                                                : "text-green-800 hover:text-green-600"
                                            }`}
                                    >
                                        {">"} {cat}
                                    </button>
                                ))}
                            </div>

                            <div className="grid gap-6 md:grid-cols-2">
                                {PROJECTS[projectCategory].map((project, i) => (
                                    <div
                                        key={i}
                                        className="group relative border border-green-900 bg-black p-6 transition-all hover:border-green-500 hover:shadow-[0_0_15px_rgba(34,197,94,0.2)]"
                                    >
                                        <h3 className="mb-2 text-xl font-bold text-green-400 group-hover:text-green-300">
                                            {project.title}
                                        </h3>
                                        <p className="text-green-700 group-hover:text-green-600">
                                            {project.desc}
                                        </p>
                                        <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
                                            <span className="text-xs text-green-500">EXECUTE_</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* INTERESTS TAB */}
                    {activeTab === "interests" && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <h2 className="mb-6 text-2xl font-bold uppercase text-green-400">
                                /usr/local/interests
                            </h2>
                            <ul className="space-y-3">
                                {INTERESTS.map((interest, i) => (
                                    <li key={i} className="flex items-center text-lg text-green-600 hover:text-green-400">
                                        <span className="mr-3 text-xs text-green-800">0x0{i}</span>
                                        {interest}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* TINKERING TAB */}
                    {activeTab === "tinkering" && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <h2 className="mb-6 text-2xl font-bold uppercase text-green-400">
                                ~/workbench
                            </h2>
                            <div className="space-y-6">
                                {TINKERING.map((item, i) => (
                                    <div key={i} className="flex items-center justify-between border-b border-green-900/50 pb-2">
                                        <span className="text-lg text-green-500">{item.title}</span>
                                        <span
                                            className={`text-xs px-2 py-1 rounded ${item.status === "Online"
                                                    ? "bg-green-900/30 text-green-400"
                                                    : item.status === "Maintenance"
                                                        ? "bg-yellow-900/30 text-yellow-500"
                                                        : "bg-blue-900/30 text-blue-400"
                                                }`}
                                        >
                                            [{item.status.toUpperCase()}]
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            </main>

            <style jsx global>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .animate-blink {
          animation: blink 1s step-end infinite;
        }
        @keyframes flicker {
          0% { opacity: 0.02; }
          5% { opacity: 0.05; }
          10% { opacity: 0.02; }
          15% { opacity: 0.06; }
          20% { opacity: 0.02; }
          50% { opacity: 0.02; }
          55% { opacity: 0.05; }
          60% { opacity: 0.02; }
          100% { opacity: 0.02; }
        }
        .animate-flicker {
          animation: flicker 0.15s infinite;
        }
        .text-shadow-glow {
          text-shadow: 0 0 10px rgba(34, 197, 94, 0.7);
        }
      `}</style>
        </div>
    );
}
