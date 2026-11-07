import { ImageResponse } from "next/og";

import { brandMarkDataUri } from "@/lib/brand-mark";

export const contentType = "image/png";
export const dynamic = "force-static";

const SIZE = 512;

// Maskable icons get cropped to the OS's own shape (circle, squircle, …), so
// the mark has to sit well inside the ~80% safe zone the spec guarantees —
// a solid background fills the rest instead of leaving it transparent.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#070b08",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brandMarkDataUri()} width={Math.round(SIZE * 0.58)} height={Math.round(SIZE * 0.58)} alt="" />
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
