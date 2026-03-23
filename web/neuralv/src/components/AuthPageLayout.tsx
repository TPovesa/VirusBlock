import type { ReactNode } from 'react';
import '../styles/auth.css';

type AuthPageLayoutProps = {
  title: string;
  description?: string;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function AuthPageLayout({ title, description, aside, footer, children }: AuthPageLayoutProps) {
  return (
    <div className="page-stack auth-page auth-page-shell">
      <section className="hero-card auth-hero auth-hero-shell">
        <div className="hero-copy auth-hero-copy">
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
          {footer ? <div className="auth-hero-footer">{footer}</div> : null}
        </div>
        <article className="content-card auth-card auth-form-card">{children}</article>
      </section>
      {aside ? <section className="section-block auth-aside-block">{aside}</section> : null}
    </div>
  );
}
