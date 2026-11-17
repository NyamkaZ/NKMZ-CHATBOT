/**
 * Next.js re-mounts a template on every navigation, so this gives each screen
 * a brief fade-in when it appears.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
