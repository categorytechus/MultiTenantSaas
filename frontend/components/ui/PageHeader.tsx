"use client";

import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="app-page-header">
      <div>
        <div className="app-page-title">{title}</div>
        {subtitle ? <div className="app-page-subtitle">{subtitle}</div> : null}
      </div>
      {actions}
    </div>
  );
}
