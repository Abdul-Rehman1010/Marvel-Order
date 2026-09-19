import { Preferences } from "@capacitor/preferences";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import MarvelNexus, { type NexusApiRequest } from "@/components/marvel-nexus";
import "../../src/app/globals.css";

const SESSION_KEY = "nexus_session_token";
const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim().replace(/\/$/, "") ?? "";

function createMobileRequest(apiOrigin: string): NexusApiRequest {
  let sessionToken: string | null = null;
  const sessionReady = Preferences.get({ key: SESSION_KEY }).then(({ value }) => {
    sessionToken = value;
  });

  return async (path, init) => {
    await sessionReady;

    const headers = new Headers(init?.headers);
    headers.set("X-Nexus-Client", "capacitor");
    if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);

    const response = await fetch(new URL(path, `${apiOrigin}/`), {
      ...init,
      headers,
      credentials: "omit",
    });

    const issuedToken = response.headers.get("X-Nexus-Session");
    if (issuedToken) {
      sessionToken = issuedToken;
      await Preferences.set({ key: SESSION_KEY, value: issuedToken });
    } else if (response.ok && path === "/api/auth/logout") {
      sessionToken = null;
      await Preferences.remove({ key: SESSION_KEY });
    } else if (response.status === 401 && path === "/api/progress") {
      sessionToken = null;
      await Preferences.remove({ key: SESSION_KEY });
    }

    return response;
  };
}

function MissingConfiguration() {
  return (
    <main className="loading-screen error-screen">
      <p className="eyebrow">MOBILE LINK NOT CONFIGURED</p>
      <h1>Add the deployed Vercel API address.</h1>
      <p className="muted">Create mobile/.env.local and set VITE_API_ORIGIN to the production site URL.</p>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {configuredOrigin ? <MarvelNexus request={createMobileRequest(configuredOrigin)} /> : <MissingConfiguration />}
  </StrictMode>,
);
