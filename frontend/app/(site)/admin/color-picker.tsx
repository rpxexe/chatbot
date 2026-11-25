"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Pipette } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { onColor } from "@/lib/appearance";

type Hsv = { h: number; s: number; v: number };

function toHex({ h, s, v }: Hsv) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function toHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const HEX = /^#[0-9a-f]{6}$/i;

/** Shade area, hue slider and hex field in a popover, styled with the app's tokens instead of the browser's picker. */
export function ColorPicker({ value, onChange, active, label = "Custom color" }: { value?: string; onChange: (hex: string) => void; active: boolean; label?: string }) {
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(value && HEX.test(value) ? value : "#1f6b4a"));
  const [text, setText] = useState(value ?? "");
  const area = useRef<HTMLDivElement>(null);
  const hex = toHex(hsv);

  // Follow outside changes (a preset), but keep the hue while dragging through grays, where hex can't carry it.
  useEffect(() => {
    if (value && HEX.test(value) && value.toLowerCase() !== hex) setHsv(toHsv(value));
    setText(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pick = (next: Hsv) => {
    setHsv(next);
    const h = toHex(next);
    setText(h);
    onChange(h);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = area.current!.getBoundingClientRect();
    pick({ h: hsv.h, s: clamp((e.clientX - r.left) / r.width), v: clamp(1 - (e.clientY - r.top) / r.height) });
  };

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!move[e.key]) return;
    e.preventDefault();
    pick({ h: hsv.h, s: clamp(hsv.s + move[e.key][0]), v: clamp(hsv.v + move[e.key][1]) });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "grid size-8 place-items-center rounded-full border bg-[conic-gradient(from_90deg,#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)] ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            active && "ring-2 ring-foreground",
          )}
          style={active && value ? { background: value, color: onColor(value) } : undefined}
        >
          {active && <Pipette className="size-3.5" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-3 p-3">
        <div
          ref={area}
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
          className="relative h-36 cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e)}
          onKeyDown={onKey}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.3)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
          />
        </div>
        <Slider
          aria-label="Hue"
          min={0}
          max={359}
          value={[Math.round(hsv.h)]}
          onValueChange={([h]) => pick({ ...hsv, h })}
          className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:shadow-[0_0_0_1px_rgb(0_0_0/0.3)] [&_[data-slot=slider-track]]:h-3! [&_[data-slot=slider-track]]:bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]"
        />
        <div className="flex items-center gap-2">
          <span className="size-8 shrink-0 rounded-md border" style={{ background: hex }} aria-hidden="true" />
          <Input
            aria-label="Hex color"
            className="h-8 font-mono text-xs uppercase"
            maxLength={7}
            value={text}
            onChange={(e) => {
              const t = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
              setText(t);
              if (HEX.test(t)) { setHsv(toHsv(t)); onChange(t.toLowerCase()); }
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
