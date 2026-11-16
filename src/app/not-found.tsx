import Link from "next/link";
import { ArrowRight, Orbit } from "lucide-react";

export default function NotFound() {
  return (
    <main className="loading-screen error-screen">
      <Orbit size={34} />
      <p className="eyebrow">OFF THE TIMELINE</p>
      <h1>Page not found</h1>
      <Link className="primary-action" href="/">
        Back to the archive <ArrowRight size={17} />
      </Link>
    </main>
  );
}
