import Link from "next/link";

// One step back up the page tree. The last crumb is usually the current place and has
// no link.
export type Crumb = { label: string; href?: string };

// The top of every logged-in page, so all pages share one rhythm: where you are
// (breadcrumb), what this is (title, with an optional status badge next to it), one
// line of context, and the page's main actions on the right. On a narrow screen the
// actions drop under the text instead of squeezing the title.
export function PageHeader({
  title,
  breadcrumb,
  badge,
  subtitle,
  actions,
}: {
  title: string;
  breadcrumb?: Crumb[];
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="crumb">
              {index > 0 && (
                <span className="crumb-sep" aria-hidden="true">
                  /
                </span>
              )}
              {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
            </span>
          ))}
        </nav>
      )}
      <div className="page-header-main">
        <div className="page-header-text">
          <div className="page-title">
            <h1>{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}
