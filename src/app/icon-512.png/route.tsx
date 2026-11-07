import { ImageResponse } from "next/og";

import { brandMarkDataUri } from "@/lib/brand-mark";

export const contentType = "image/png";
export const dynamic = "force-static";

const SIZE = 512;

export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brandMarkDataUri()} width={Math.round(SIZE * 0.88)} height={Math.round(SIZE * 0.88)} alt="" />
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
