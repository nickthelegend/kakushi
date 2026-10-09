/** Generated artwork (public/art). Falls back to an indigo field if a file is missing. */
export function Art({ src, alt, className, priority }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
      style={{ background: "radial-gradient(ellipse at 60% 40%, #1b2c4a, #0b1424 70%)" }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.opacity = "0";
      }}
    />
  );
}
