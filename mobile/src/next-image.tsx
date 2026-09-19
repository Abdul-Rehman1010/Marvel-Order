import type { CSSProperties, ImgHTMLAttributes } from "react";

type MobileImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src"> & {
  src: string | { src: string };
  alt: string;
  fill?: boolean;
  priority?: boolean;
};

export default function MobileImage({ alt, fill, priority, src, style, ...props }: MobileImageProps) {
  const resolvedSource = typeof src === "string" ? src : src.src;
  const fillStyle: CSSProperties | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style }
    : style;

  return (
    // The native bundle needs a regular WebView image rather than Next.js image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={alt}
      src={resolvedSource}
      style={fillStyle}
      loading={priority ? "eager" : props.loading}
      fetchPriority={priority ? "high" : props.fetchPriority}
    />
  );
}
