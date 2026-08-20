import React from "react";
import "./LiquidGlass.css";

interface LiquidGlassProps {
  children: React.ReactNode;
  className?: string;
}

export const LiquidGlass: React.FC<LiquidGlassProps> = ({ children, className = "" }) => {
  return (
    <div className={`liquid-glass-container ${className}`}>
      <div className="liquid-glass-content">{children}</div>
    </div>
  );
};
