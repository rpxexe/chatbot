import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** List entry used by the FAQ, document, intent and synonym panels; dimmed when disabled. */
export function ItemCard({ enabled = true, className, ...props }: React.ComponentProps<"div"> & { enabled?: boolean }) {
  return (
    <li>
      <Card size="sm" className={cn("gap-2 px-4", !enabled && "opacity-60", className)} {...props} />
    </li>
  );
}

export function EnabledSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <Label className="shrink-0 font-normal whitespace-nowrap">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label ?? (checked ? "Enabled" : "Disabled")}
    </Label>
  );
}

/** Muted explanation inside a form label. */
export const Hint = ({ children }: { children: React.ReactNode }) => <span className="font-normal text-muted-foreground">{children}</span>;
