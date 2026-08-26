import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function useProofMotion() {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reduced) return;

      gsap.from(".hero-copy > *", {
        autoAlpha: 0,
        duration: 0.65,
        stagger: 0.08,
        y: 22,
        ease: "power3.out",
      });
      gsap.fromTo(
        ".relay-progress",
        { scaleX: 0 },
        {
          duration: 1.1,
          ease: "power2.inOut",
          scaleX: 1,
          transformOrigin: "left",
        },
      );
      gsap.utils.toArray<HTMLElement>(".evidence-sheet").forEach((sheet) => {
        gsap.from(sheet, {
          autoAlpha: 0.35,
          scrollTrigger: { end: "top 48%", scrub: true, start: "top 88%" },
          x: 42,
        });
      });
      ScrollTrigger.refresh();
    },
    { scope },
  );

  return scope;
}
