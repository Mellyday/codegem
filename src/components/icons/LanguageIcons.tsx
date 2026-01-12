/**
 * Language-specific SVG icons for the SandboxViewer header.
 * Polished designs with official branding colors.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/**
 * C - Classic blue tile with serif "C"
 */
export const CIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#00599C" rx="20" />
        <text
            x="64"
            y="80"
            fontFamily="serif"
            fontSize="90"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            C
        </text>
    </svg>
);

/**
 * C++ - Darker blue tile with C and two plus signs
 */
export const CppIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#004482" rx="20" />
        <text
            x="45"
            y="80"
            fontFamily="sans-serif"
            fontSize="75"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            C
        </text>
        <path d="M85 50 V70 M75 60 H95" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
        <path d="M110 50 V70 M100 60 H120" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
    </svg>
);

/**
 * Go (Golang) - Brand cyan with minimalist "GO" text
 */
export const GoIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#00ADD8" rx="20" />
        <text
            x="64"
            y="78"
            fontFamily="sans-serif"
            fontSize="60"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
            letterSpacing="-2"
        >
            GO
        </text>
    </svg>
);

/**
 * Java - Stylized coffee cup silhouette
 */
export const JavaIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#5382A1" rx="20" />
        <path fill="#FFFFFF" d="M38,90 C38,105 50,110 64,110 C78,110 90,105 90,90 L90,60 L38,60 Z" />
        <path fill="none" stroke="#FFFFFF" strokeWidth="8" d="M90,68 C105,68 105,85 90,85" />
        <path
            fill="none"
            stroke="#F89820"
            strokeWidth="5"
            strokeLinecap="round"
            d="M50,45 Q55,30 50,20 M64,45 Q69,30 64,20 M78,45 Q83,30 78,20"
        />
    </svg>
);

/**
 * JavaScript - Official yellow with black "JS"
 */
export const JavaScriptIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#F7DF1E" rx="20" />
        <text
            x="94"
            y="95"
            fontFamily="sans-serif"
            fontSize="55"
            fill="#000000"
            textAnchor="middle"
            fontWeight="bold"
        >
            JS
        </text>
    </svg>
);

/**
 * TypeScript - Blue with white "TS"
 */
export const TypeScriptIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#3178C6" rx="20" />
        <text
            x="94"
            y="95"
            fontFamily="sans-serif"
            fontSize="55"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            TS
        </text>
    </svg>
);

/**
 * Kotlin - Geometric ribbon gradient
 */
export const KotlinIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <defs>
            <linearGradient id="kotlinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: "#E24462", stopOpacity: 1 }} />
                <stop offset="50%" style={{ stopColor: "#7F52FF", stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: "#7F52FF", stopOpacity: 1 }} />
            </linearGradient>
        </defs>
        <rect width="128" height="128" fill="#1B1B1B" rx="20" />
        <path fill="url(#kotlinGrad)" d="M24,24 L74,24 L24,74 Z" />
        <path fill="url(#kotlinGrad)" d="M24,104 L64,64 L104,104 L54,104 Z" />
        <path fill="url(#kotlinGrad)" d="M24,74 L74,24 L104,24 L24,104 Z" />
    </svg>
);

/**
 * PHP - Classic indigo oval
 */
export const PHPIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#777BB4" rx="20" />
        <ellipse cx="64" cy="64" rx="50" ry="30" fill="#5D608F" />
        <text
            x="64"
            y="75"
            fontFamily="sans-serif"
            fontSize="40"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
            letterSpacing="2"
        >
            php
        </text>
    </svg>
);

/**
 * Python - Intertwined blue and yellow snakes
 */
export const PythonIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#202020" rx="20" />
        {/* Top Snake (Blue) */}
        <path
            fill="#3776AB"
            d="M64,28 C50,28 44,32 44,40 L44,52 L76,52 L76,64 L34,64 L34,40 C34,24 46,16 64,16 C82,16 94,24 94,40 L94,46 L82,46 L82,40 C82,32 76,28 64,28 Z"
        />
        <circle cx="56" cy="34" r="3" fill="#FFFFFF" />
        {/* Bottom Snake (Yellow) */}
        <path
            fill="#FFD43B"
            d="M64,100 C78,100 84,96 84,88 L84,76 L52,76 L52,64 L94,64 L94,88 C94,104 82,112 64,112 C46,112 34,104 34,88 L34,82 L46,82 L46,88 C46,96 52,100 64,100 Z"
        />
        <circle cx="72" cy="94" r="3" fill="#FFFFFF" />
    </svg>
);

/**
 * Ruby - Red faceted gemstone
 */
export const RubyIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#CC342D" rx="20" />
        <path fill="#9b111e" d="M40,45 L88,45 L100,65 L64,105 L28,65 Z" />
        <path
            fill="none"
            stroke="#E99FA4"
            strokeWidth="2"
            d="M40,45 L64,105 M88,45 L64,105 M28,65 L100,65 M40,45 L28,65 M88,45 L100,65"
        />
        <path fill="#FFFFFF" opacity="0.3" d="M64,65 L88,45 L100,65 Z" />
    </svg>
);

/**
 * Rust - Orange gear with "R" (simplified)
 */
export const RustIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#DEA584" rx="20" />
        <circle cx="64" cy="64" r="40" fill="#000000" />
        <text
            x="64"
            y="82"
            fontFamily="sans-serif"
            fontSize="55"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            R
        </text>
        {/* Gear teeth hints */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <rect
                key={angle}
                x="60"
                y="18"
                width="8"
                height="12"
                rx="2"
                fill="#000000"
                transform={`rotate(${angle} 64 64)`}
            />
        ))}
    </svg>
);

/**
 * HTML - Orange shield with angle brackets
 */
export const HTMLIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#E34F26" rx="20" />
        <text
            x="64"
            y="50"
            fontFamily="sans-serif"
            fontSize="30"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            {"</>"}
        </text>
        <text
            x="64"
            y="90"
            fontFamily="sans-serif"
            fontSize="40"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            HTML
        </text>
    </svg>
);

/**
 * CSS - Blue/purple with curly braces
 */
export const CSSIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#264DE4" rx="20" />
        <text
            x="64"
            y="50"
            fontFamily="sans-serif"
            fontSize="30"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            {"{ }"}
        </text>
        <text
            x="64"
            y="90"
            fontFamily="sans-serif"
            fontSize="45"
            fill="#FFFFFF"
            textAnchor="middle"
            fontWeight="bold"
        >
            CSS
        </text>
    </svg>
);

/**
 * JSON - Dark with braces notation
 */
export const JSONIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#292929" rx="20" />
        <text
            x="64"
            y="80"
            fontFamily="monospace"
            fontSize="45"
            fill="#F5F5F5"
            textAnchor="middle"
            fontWeight="bold"
        >
            {"{ }"}
        </text>
    </svg>
);

/**
 * Markdown - Dark with "M" and down arrow
 */
export const MarkdownIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#083FA1" rx="20" />
        <path
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M30,85 L30,43 L50,63 L70,43 L70,85"
        />
        <path
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M90,55 L90,85 M80,75 L90,85 L100,75"
        />
    </svg>
);

/**
 * Generic File icon - Simple document
 */
export const GenericFileIcon = ({ className, ...props }: IconProps) => (
    <svg viewBox="0 0 128 128" className={className} {...props}>
        <rect width="128" height="128" fill="#6B7280" rx="20" />
        <path fill="#FFFFFF" d="M35,20 L35,108 L93,108 L93,45 L68,20 Z" />
        <path fill="#D1D5DB" d="M68,20 L68,45 L93,45 Z" />
        <rect x="45" y="58" width="38" height="6" rx="3" fill="#9CA3AF" />
        <rect x="45" y="72" width="38" height="6" rx="3" fill="#9CA3AF" />
        <rect x="45" y="86" width="25" height="6" rx="3" fill="#9CA3AF" />
    </svg>
);
