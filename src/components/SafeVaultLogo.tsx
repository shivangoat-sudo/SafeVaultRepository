import React from "react";

interface SafeVaultIconProps {
  className?: string;
}

export function SafeVaultIcon({ className = "h-8 w-8" }: SafeVaultIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={`${className} shrink-0`}
      aria-label="SafeVault Logo"
      shapeRendering="geometricPrecision"
    >
      {/* Dark background with rounded corners */}
      <rect x="5" y="5" width="90" height="90" rx="22" ry="22" fill="#2d313a" />
      
      {/* White shield outline */}
      <path
        d="M 50,22 
           C 60,28 70,28 72,28 
           L 72,48 
           C 72,66 58,74 50,78 
           C 42,74 28,66 28,48 
           L 28,28 
           C 30,28 40,28 50,22 Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SafeVaultLogoProps {
  className?: string;
  showText?: boolean;
  textSize?: string;
  textClassName?: string;
}

export function SafeVaultLogo({
  className = "h-8 w-8",
  showText = true,
  textSize = "text-xl",
  textClassName = "text-ink-900",
}: SafeVaultLogoProps) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <SafeVaultIcon className={className} />
      {showText && (
        <span className={`font-semibold tracking-tight ${textClassName} ${textSize} leading-none antialiased`}>
          SafeVault
        </span>
      )}
    </div>
  );
}
