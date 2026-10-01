import { useEffect, useRef } from "react";
import { hexToRgbTriplet } from "../lib/app-helpers";

export function WaterRippleBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const surfaceCandidate = canvasRef.current;
    if (!surfaceCandidate) return;
    const surfaceElement: HTMLCanvasElement = surfaceCandidate;

    const contextCandidate = surfaceElement.getContext("2d");
    if (!contextCandidate) return;
    const drawingContext: CanvasRenderingContext2D = contextCandidate;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    type Drop = {
      x: number;
      y: number;
      targetY: number;
      speed: number;
      rippleAge: number;
      rippleDuration: number;
      radius: number;
      alpha: number;
      hit: boolean;
    };

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let lastDropAt = 0;
    let drops: Drop[] = [];

    function resize() {
      const rect = surfaceElement.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      surfaceElement.width = Math.floor(width * pixelRatio);
      surfaceElement.height = Math.floor(height * pixelRatio);
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function createDrop(now: number) {
      drops.push({
        x: width * (0.12 + Math.random() * 0.76),
        y: -24,
        targetY: height * (0.58 + Math.random() * 0.28),
        speed: 150 + Math.random() * 95,
        rippleAge: 0,
        rippleDuration: 2600 + Math.random() * 900,
        radius: 22 + Math.random() * 18,
        alpha: 0.16 + Math.random() * 0.16,
        hit: false
      });
      lastDropAt = now;
    }

    function readRippleColors(isDark: boolean): { rgb: string; soft: string } {
      const styles = getComputedStyle(document.documentElement);
      const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      return {
        rgb: hexToRgbTriplet(read(isDark ? "--vc-accent-ink-dark" : "--vc-accent-strong", isDark ? "#ffb08a" : "#c2410c")),
        soft: read("--vc-accent-soft-light", "#fff0e8")
      };
    }

    let rippleColors = readRippleColors(document.documentElement.dataset.theme === "dark");
    let rippleColorsReadAt = 0;

    function draw(now: number) {
      const delta = Math.min(40, now - lastFrameAt);
      lastFrameAt = now;
      const isDark = document.documentElement.dataset.theme === "dark";
      if (now - rippleColorsReadAt > 500) {
        rippleColors = readRippleColors(isDark);
        rippleColorsReadAt = now;
      }
      const accentRgb = rippleColors.rgb;

      drawingContext.clearRect(0, 0, width, height);

      const gradient = drawingContext.createLinearGradient(0, 0, width, height);
      if (isDark) {
        gradient.addColorStop(0, "#0f1114");
        gradient.addColorStop(0.52, "#111418");
        gradient.addColorStop(1, "#090b0e");
      } else {
        gradient.addColorStop(0, rippleColors.soft);
        gradient.addColorStop(0.52, "#f3f4f6");
        gradient.addColorStop(1, "#e9ecef");
      }
      drawingContext.fillStyle = gradient;
      drawingContext.fillRect(0, 0, width, height);

      if (!reducedMotion.matches && now - lastDropAt > 720 + Math.random() * 520) createDrop(now);

      drawingContext.globalCompositeOperation = "source-over";
      drops = drops.filter((drop) => {
        if (!drop.hit) {
          drop.y += drop.speed * (delta / 1000);
          const trail = drawingContext.createLinearGradient(drop.x, drop.y - 42, drop.x, drop.y + 8);
          trail.addColorStop(0, `rgba(${accentRgb}, 0)`);
          trail.addColorStop(1, `rgba(${accentRgb}, ${isDark ? 0.28 : 0.22})`);
          drawingContext.strokeStyle = trail;
          drawingContext.lineWidth = 1.4;
          drawingContext.beginPath();
          drawingContext.moveTo(drop.x, drop.y - 42);
          drawingContext.lineTo(drop.x, drop.y);
          drawingContext.stroke();
          drawingContext.fillStyle = `rgba(${accentRgb}, ${isDark ? 0.64 : 0.58})`;
          drawingContext.beginPath();
          drawingContext.arc(drop.x, drop.y, 2.2, 0, Math.PI * 2);
          drawingContext.fill();
          if (drop.y >= drop.targetY) drop.hit = true;
          return true;
        }

        drop.rippleAge += delta;
        const progress = Math.min(1, drop.rippleAge / drop.rippleDuration);
        const ease = 1 - Math.pow(1 - progress, 2);
        const alpha = drop.alpha * (1 - progress);
        drawingContext.strokeStyle = `rgba(${accentRgb}, ${alpha})`;
        drawingContext.lineWidth = 1.2;
        for (let ring = 0; ring < 3; ring += 1) {
          const ringProgress = Math.max(0, ease - ring * 0.16);
          if (ringProgress <= 0) continue;
          drawingContext.beginPath();
          drawingContext.ellipse(
            drop.x,
            drop.targetY,
            drop.radius * (1 + ringProgress * 4.8),
            drop.radius * (0.28 + ringProgress * 1.1),
            0,
            0,
            Math.PI * 2
          );
          drawingContext.stroke();
        }
        return drop.rippleAge < drop.rippleDuration;
      });

      drawingContext.globalCompositeOperation = "source-over";
      animationFrame = window.requestAnimationFrame(draw);
    }

    resize();
    for (let index = 0; index < 4; index += 1) createDrop(performance.now() - index * 500);
    animationFrame = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="water-ripple-backdrop" aria-hidden="true" />;
}
