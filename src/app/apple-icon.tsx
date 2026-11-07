import { ImageResponse } from "next/og";

import { brandMarkDataUri } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS composites apple-touch-icon without alpha, so (unlike the manifest's
// "any"-purpose icons) this needs an opaque background rather than transparent corners.
export default function AppleIcon() {
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
        <img src={brandMarkDataUri()} width={Math.round(size.width * 0.66)} height={Math.round(size.height * 0.66)} alt="" />
      </div>
    ),
    { ...size },
  );
}
