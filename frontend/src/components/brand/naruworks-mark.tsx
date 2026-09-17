import Image from "next/image";

type NaruWorksMarkProps = {
  className?: string;
};

export function NaruWorksMark({ className }: NaruWorksMarkProps) {
  return (
    <span className={`naruworks-mark ${className ?? ""}`} aria-hidden="true">
      <Image
        className="naruworks-mark-light"
        src="/brand/naruworks-mark-light.svg"
        alt=""
        width={64}
        height={64}
      />
      <Image
        className="naruworks-mark-dark"
        src="/brand/naruworks-mark-dark.svg"
        alt=""
        width={64}
        height={64}
      />
    </span>
  );
}
