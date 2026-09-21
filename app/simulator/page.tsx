import type { Metadata } from "next";

import { SimulatorClient } from "./simulator-client";

export const metadata: Metadata = {
  title: "Error simulator",
  description: "Run a repeatable error capture and grouping walkthrough.",
};

export default function SimulatorPage() {
  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Playground</p>
          <h1>Error simulator</h1>
          <p>
            Follow a repeatable demo from browser failure to grouped issue—then
            inspect exactly why each occurrence matched.
          </p>
        </div>
      </header>
      <SimulatorClient />
    </div>
  );
}
